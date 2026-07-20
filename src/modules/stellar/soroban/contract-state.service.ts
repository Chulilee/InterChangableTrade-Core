import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { SorobanClientService } from './soroban-client.service';
import { SorobanApplicationError, classifySdkError } from './soroban.errors';

/** A single contract storage entry, decoded to native values. */
export interface ContractStateEntry<T = unknown> {
  contractId: string;
  /** The storage key, echoed back as provided. */
  key: unknown;
  /** The stored value decoded to a native JS value. */
  value: T;
  /** Ledger the entry was last modified in. */
  lastModifiedLedger?: number;
  /** Ledger until which the entry stays live (TTL) before it must be restored. */
  liveUntilLedger?: number;
  /** Whether this read was served from cache. */
  cached: boolean;
  /** Epoch millis at which the value was fetched from the network. */
  fetchedAt: number;
}

/**
 * Contract state reading with a Redis-backed cache.
 *
 * Contract storage lives on-chain as ledger entries keyed by an ScVal. Reading
 * it every time is a network round-trip, so this service caches decoded values
 * in Redis with a short TTL (`SOROBAN_STATE_CACHE_TTL_SECS`). Callers get a
 * consistent {@link ContractStateEntry} whether the value came from cache or the
 * network, and can force a refresh or explicitly invalidate a key when they know
 * a write has changed it.
 */
@Injectable()
export class ContractStateService {
  private readonly logger = new Logger(ContractStateService.name);
  private readonly cacheTtlSecs: number;
  private static readonly KEY_PREFIX = 'soroban:state:';

  constructor(
    private readonly client: SorobanClientService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.cacheTtlSecs =
      this.configService.get<number>('soroban.stateCacheTtlSecs') ?? 30;
  }

  /**
   * Reads a contract storage entry, serving from cache when fresh. Pass a native
   * `key` (string, number, or a structured value) — it is marshaled to the ScVal
   * the ledger uses. Set `forceRefresh` to bypass the cache.
   */
  async getState<T = unknown>(
    contractId: string,
    key: unknown,
    options: { durability?: rpc.Durability; forceRefresh?: boolean } = {},
  ): Promise<ContractStateEntry<T>> {
    const durability = options.durability ?? rpc.Durability.Persistent;
    const cacheKey = this.cacheKey(contractId, key, durability);

    if (!options.forceRefresh) {
      const cached = await this.readCache<T>(cacheKey);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    const fresh = await this.fetchFromNetwork<T>(contractId, key, durability);
    await this.writeCache(cacheKey, fresh);
    return fresh;
  }

  /**
   * Invalidates the cached value for a specific key. Call this after a write
   * that you know mutated the entry, so the next read re-fetches from chain.
   */
  async invalidate(
    contractId: string,
    key: unknown,
    durability: rpc.Durability = rpc.Durability.Persistent,
  ): Promise<void> {
    await this.redis.del(this.cacheKey(contractId, key, durability));
  }

  /** Drops every cached state entry for a contract. */
  async invalidateContract(contractId: string): Promise<number> {
    const pattern = `${ContractStateService.KEY_PREFIX}${contractId}:*`;
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length) {
        removed += await this.redis.del(...keys);
      }
    } while (cursor !== '0');
    return removed;
  }

  private async fetchFromNetwork<T>(
    contractId: string,
    key: unknown,
    durability: rpc.Durability,
  ): Promise<ContractStateEntry<T>> {
    const scKey = this.toScKey(key);
    let entry: rpc.Api.LedgerEntryResult;
    try {
      entry = await this.client
        .getServer()
        .getContractData(contractId, scKey, durability);
    } catch (error) {
      throw classifySdkError(error, { contractId });
    }

    const value = this.decodeEntryValue<T>(entry.val);
    return {
      contractId,
      key,
      value,
      lastModifiedLedger: entry.lastModifiedLedgerSeq,
      liveUntilLedger: entry.liveUntilLedgerSeq,
      cached: false,
      fetchedAt: Date.now(),
    };
  }

  /** Marshals a native key into the ScVal the ledger uses for lookups. */
  private toScKey(key: unknown): xdr.ScVal {
    try {
      return key instanceof xdr.ScVal ? key : nativeToScVal(key);
    } catch (error) {
      throw new SorobanApplicationError(
        `Could not encode contract state key: ${(error as Error).message}`,
      );
    }
  }

  /** Decodes the ledger entry's contract-data value to a native JS value. */
  private decodeEntryValue<T>(val: xdr.LedgerEntryData): T {
    const scVal = val.contractData().val();
    return scValToNative(scVal) as T;
  }

  private cacheKey(
    contractId: string,
    key: unknown,
    durability: rpc.Durability,
  ): string {
    // A stable, collision-resistant string form of the (contract, key,
    // durability) tuple. JSON handles structured keys; primitives pass through.
    const keyPart = this.stableStringify(key);
    return `${ContractStateService.KEY_PREFIX}${contractId}:${durability}:${keyPart}`;
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return String(value);
    }
    // Sort object keys so equivalent keys map to the same cache entry.
    return JSON.stringify(value, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.keys(v)
            .sort()
            .reduce(
              (acc, k) => ({ ...acc, [k]: (v as Record<string, unknown>)[k] }),
              {},
            )
        : typeof v === 'bigint'
          ? v.toString()
          : v,
    );
  }

  private async readCache<T>(
    cacheKey: string,
  ): Promise<ContractStateEntry<T> | null> {
    try {
      const raw = await this.redis.get(cacheKey);
      return raw ? (JSON.parse(raw) as ContractStateEntry<T>) : null;
    } catch (error) {
      // A cache failure must never break a read — log and fall through to chain.
      this.logger.warn(
        `State cache read failed for ${cacheKey}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async writeCache<T>(
    cacheKey: string,
    entry: ContractStateEntry<T>,
  ): Promise<void> {
    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(entry, (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
        'EX',
        this.cacheTtlSecs,
      );
    } catch (error) {
      this.logger.warn(
        `State cache write failed for ${cacheKey}: ${(error as Error).message}`,
      );
    }
  }
}
