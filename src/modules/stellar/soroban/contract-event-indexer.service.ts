import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { SorobanClientService } from './soroban-client.service';
import { ParsedContractEvent } from './soroban.types';

/**
 * Contract event parsing and indexing.
 *
 * Soroban emits events per contract call; the RPC `getEvents` endpoint exposes
 * them by ledger range. This service runs a lightweight poll loop (default
 * every 500ms, well under the 1-second indexing requirement) that pulls new
 * events for the contracts it is watching, decodes their topics and body to
 * native values, and stores them in Redis:
 *
 *  - each event is stored under its unique RPC id (deduped, TTL-bounded);
 *  - a per-contract sorted set indexes events by ledger for range queries.
 *
 * Indexing is idempotent — replaying the same events (e.g. after a restart from
 * an earlier cursor) never produces duplicates.
 */
@Injectable()
export class ContractEventIndexerService implements OnModuleDestroy {
  private readonly logger = new Logger(ContractEventIndexerService.name);
  private readonly pollIntervalMs: number;
  private readonly retentionSecs: number;
  private readonly pageLimit: number;

  /** Contracts currently being indexed. */
  private readonly watched = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  /** Ledger cursor: we've indexed everything strictly before this. */
  private nextStartLedger: number | null = null;

  private static readonly EVENT_PREFIX = 'soroban:event:';
  private static readonly INDEX_PREFIX = 'soroban:events:';

  constructor(
    private readonly client: SorobanClientService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.pollIntervalMs =
      this.configService.get<number>('soroban.eventPollIntervalMs') ?? 500;
    this.retentionSecs =
      this.configService.get<number>('soroban.eventRetentionSecs') ?? 86400;
    this.pageLimit =
      this.configService.get<number>('soroban.eventPageLimit') ?? 100;
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /**
   * Begins watching a contract for events and starts the poll loop if it isn't
   * already running. Optionally seeds the starting ledger; by default indexing
   * begins from the current ledger.
   */
  async watch(contractId: string, fromLedger?: number): Promise<void> {
    this.watched.add(contractId);
    if (this.nextStartLedger === null) {
      this.nextStartLedger =
        fromLedger ?? (await this.client.getLatestLedgerSequence());
    } else if (fromLedger !== undefined) {
      this.nextStartLedger = Math.min(this.nextStartLedger, fromLedger);
    }
    this.start();
    this.logger.log(
      `Watching contract ${contractId} for events from ledger ${this.nextStartLedger}.`,
    );
  }

  /** Stops watching a single contract; leaves already-indexed events in place. */
  unwatch(contractId: string): void {
    this.watched.delete(contractId);
    if (this.watched.size === 0) {
      this.stop();
    }
  }

  /** Starts the poll loop. Idempotent. */
  start(): void {
    if (this.timer || this.watched.size === 0) {
      return;
    }
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    // Don't keep the event loop alive solely for polling.
    this.timer.unref?.();
  }

  /** Stops the poll loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Returns indexed events for a contract, most recent first, optionally bounded
   * by a starting ledger. Reads from the Redis index, so it is cheap and does
   * not hit the network.
   */
  async getEvents(
    contractId: string,
    options: { fromLedger?: number; limit?: number } = {},
  ): Promise<ParsedContractEvent[]> {
    const indexKey = this.indexKey(contractId);
    const min = options.fromLedger ?? '-inf';
    const limit = options.limit ?? 100;

    // Sorted-set members are event ids, scored by ledger. Pull newest first.
    const ids = await this.redis.zrevrangebyscore(
      indexKey,
      '+inf',
      min,
      'LIMIT',
      0,
      limit,
    );
    if (!ids.length) {
      return [];
    }
    const raws = await this.redis.mget(...ids.map((id) => this.eventKey(id)));
    return raws
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as ParsedContractEvent);
  }

  /** One poll cycle: fetch new events for all watched contracts and index them. */
  private async poll(): Promise<void> {
    if (this.polling || this.watched.size === 0) {
      return;
    }
    this.polling = true;
    try {
      const startLedger =
        this.nextStartLedger ?? (await this.client.getLatestLedgerSequence());

      const response = await this.client.getServer().getEvents({
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: Array.from(this.watched),
          },
        ],
        limit: this.pageLimit,
      });

      for (const event of response.events) {
        await this.indexEvent(event);
      }

      // Advance the cursor past the ledgers we've now seen so the next poll
      // only asks for newer events.
      this.nextStartLedger = response.latestLedger + 1;
    } catch (error) {
      // Polling is best-effort and self-healing: log and retry next tick rather
      // than tearing down the loop on a transient RPC hiccup.
      this.logger.warn(
        `Event poll failed: ${(error as Error).message}. Retrying next cycle.`,
      );
    } finally {
      this.polling = false;
    }
  }

  /** Parses and stores a single event, idempotently. */
  private async indexEvent(event: rpc.Api.EventResponse): Promise<void> {
    const parsed = this.parseEvent(event);
    const eventKey = this.eventKey(parsed.id);

    // SET NX makes indexing idempotent: a replayed event is skipped cheaply.
    const stored = await this.redis.set(
      eventKey,
      JSON.stringify(parsed),
      'EX',
      this.retentionSecs,
      'NX',
    );
    if (stored === null) {
      return; // already indexed
    }

    const indexKey = this.indexKey(parsed.contractId);
    await this.redis.zadd(indexKey, parsed.ledger, parsed.id);
    await this.redis.expire(indexKey, this.retentionSecs);
  }

  /** Normalizes a raw RPC event into our JSON-friendly indexed shape. */
  private parseEvent(event: rpc.Api.EventResponse): ParsedContractEvent {
    return {
      id: event.id,
      contractId: event.contractId?.contractId() ?? '',
      type: event.type,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
      topics: event.topic.map((t) => this.safeDecode(t)),
      value: this.safeDecode(event.value),
      txHash: event.txHash,
      pagingToken: event.pagingToken,
      indexedAt: Date.now(),
    };
  }

  /** Decodes an ScVal to native, tolerating values that can't be decoded. */
  private safeDecode(val: xdr.ScVal): unknown {
    try {
      return scValToNative(val);
    } catch {
      return val.toXDR('base64');
    }
  }

  private eventKey(id: string): string {
    return `${ContractEventIndexerService.EVENT_PREFIX}${id}`;
  }

  private indexKey(contractId: string): string {
    return `${ContractEventIndexerService.INDEX_PREFIX}${contractId}`;
  }
}
