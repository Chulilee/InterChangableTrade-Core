import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { SorobanClientService } from './soroban-client.service';
import { ParsedContractEvent } from './soroban.types';

/**
 * The `getEvents` response as returned by the Soroban RPC.
 *
 * The RPC protocol returns an opaque `cursor` next to the events, but
 * `stellar-sdk` v12.3.0 does not declare it on `Api.GetEventsResponse` and
 * its `parseRawEvents` parser drops it before the value reaches us. Reading
 * it through this widened type keeps the cursor path available (and
 * compiling) so it activates automatically on an SDK that surfaces it, while
 * the service falls back to ledger-anchored paging in the meantime.
 */
type GetEventsResponse = rpc.Api.GetEventsResponse & { cursor?: string };

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
  /**
   * Per-contract ledger cursor: we've indexed everything strictly before this
   * ledger for the given contract. Kept per contract so that multiple watched
   * contracts do not interfere with each other's paging.
   */
  private readonly nextStartLedgerByContract = new Map<string, number>();

  /** Upper bound on pages fetched in a single poll cycle (safety valve). */
  private static readonly MAX_PAGES_PER_POLL = 100;

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
    const start =
      fromLedger ?? (await this.client.getLatestLedgerSequence());
    const current = this.nextStartLedgerByContract.get(contractId);
    if (current === undefined || start < current) {
      this.nextStartLedgerByContract.set(contractId, start);
    }
    this.start();
    this.logger.log(
      `Watching contract ${contractId} for events from ledger ${this.nextStartLedgerByContract.get(contractId)}.`,
    );
  }

  /** Stops watching a single contract; leaves already-indexed events in place. */
  unwatch(contractId: string): void {
    this.watched.delete(contractId);
    this.nextStartLedgerByContract.delete(contractId);
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

  /** One poll cycle: fetch new events for every watched contract. */
  private async poll(): Promise<void> {
    if (this.polling || this.watched.size === 0) {
      return;
    }
    this.polling = true;
    try {
      await Promise.all(
        Array.from(this.watched).map((contractId) =>
          this.pollContract(contractId),
        ),
      );
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

  /**
   * Fetches and indexes all new events for a single contract, paging through
   * the requested ledger range until it is exhausted.
   *
   * `getEvents` returns at most `limit` events. Advancing to `latestLedger`
   * unconditionally would skip the remainder permanently, so we never do that:
   * the cursor is advanced only past the last **processed** event.
   *
   * Two paging strategies are used:
   *
   * 1. **RPC cursor** — the Soroban RPC returns an opaque `cursor` alongside the
   *    events. `stellar-sdk` v12.3.0 does not declare it on
   *    `Api.GetEventsResponse` (and its parser drops it), so it is read
   *    defensively; the path activates automatically once the SDK surfaces it.
   * 2. **Ledger anchoring** — the fallback used on SDK v12, where no cursor is
   *    available. A full page means there may be more events, so the next
   *    request re-reads from the last ledger that was processed. Events that
   *    were already indexed are skipped idempotently, so re-reading is safe.
   */
  private async pollContract(contractId: string): Promise<void> {
    try {
      const startLedger =
        this.nextStartLedgerByContract.get(contractId) ??
        (await this.client.getLatestLedgerSequence());

      let currentStart = startLedger;
      let cursor: string | undefined;
      let pages = 0;
      let lastProcessedLedger: number | null = null;
      let latestLedger = startLedger;

      for (;;) {
        const response = (await this.client.getServer().getEvents({
          startLedger: currentStart,
          filters: [{ type: 'contract', contractIds: [contractId] }],
          limit: this.pageLimit,
          ...(cursor ? { cursor } : {}),
        })) as GetEventsResponse;

        if (typeof response.latestLedger === 'number') {
          latestLedger = response.latestLedger;
        }

        for (const event of response.events) {
          await this.indexEvent(event);
          if (lastProcessedLedger === null || event.ledger > lastProcessedLedger) {
            lastProcessedLedger = event.ledger;
          }
        }

        const nextCursor = response.cursor;
        const pageIsFull = response.events.length >= this.pageLimit;

        // 1. The RPC cursor is authoritative when the SDK surfaces it.
        if (nextCursor && response.events.length > 0) {
          if (pageIsFull) {
            this.logger.warn(
              `Contract ${contractId}: full page of ${this.pageLimit} events with ` +
                `more pages pending — paging through to avoid silent event loss.`,
            );
          }
          cursor = nextCursor;
          if (lastProcessedLedger !== null) {
            currentStart = lastProcessedLedger;
          }
          pages += 1;
          if (pages >= ContractEventIndexerService.MAX_PAGES_PER_POLL) {
            this.logger.warn(
              `Contract ${contractId}: reached page cap ` +
                `(${ContractEventIndexerService.MAX_PAGES_PER_POLL}); resuming next cycle.`,
            );
            break;
          }
          continue;
        }

        // 2. No cursor available: a full page means there may be more events
        //    beyond it. Re-read from the last ledger that was processed so
        //    nothing is skipped; already-indexed events are deduplicated.
        if (pageIsFull && lastProcessedLedger !== null) {
          if (lastProcessedLedger <= currentStart) {
            // A single ledger holds more events than one page can return and
            // there is no cursor to page through them.
            this.logger.warn(
              `Contract ${contractId}: ledger ${currentStart} holds more than ` +
                `${this.pageLimit} events and no RPC cursor is available — the ` +
                `remaining events in that ledger cannot be retrieved. ` +
                `Raise SOROBAN_EVENT_PAGE_LIMIT to widen the page.`,
            );
            break;
          }
          this.logger.warn(
            `Contract ${contractId}: full page of ${this.pageLimit} events and no RPC ` +
              `cursor — re-reading from ledger ${lastProcessedLedger} to avoid ` +
              `silent event loss.`,
          );
          currentStart = lastProcessedLedger;
          pages += 1;
          if (pages >= ContractEventIndexerService.MAX_PAGES_PER_POLL) {
            this.logger.warn(
              `Contract ${contractId}: reached page cap ` +
                `(${ContractEventIndexerService.MAX_PAGES_PER_POLL}); resuming next cycle.`,
            );
            break;
          }
          continue;
        }

        break;
      }

      const advanceTo =
        lastProcessedLedger !== null ? lastProcessedLedger + 1 : latestLedger + 1;
      this.nextStartLedgerByContract.set(contractId, advanceTo);
    } catch (error) {
      // Per-contract failures must not abort the other contracts in this cycle.
      this.logger.warn(
        `Event poll for contract ${contractId} failed: ` +
          `${(error as Error).message}. Retrying next cycle.`,
      );
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
