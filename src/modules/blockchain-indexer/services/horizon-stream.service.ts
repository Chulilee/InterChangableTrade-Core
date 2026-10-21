import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import { IndexingStateService } from './indexing-state.service';

/**
 * Emitted when a new ledger close event is received from Horizon.
 */
export interface LedgerCloseEvent {
  sequence: number;
  closedAt: string;
  hash: string;
  /** Horizon paging token for this ledger, used to resume the stream. */
  pagingToken?: string;
  header: Record<string, unknown>;
}

/**
 * Emitted when the stream health status changes.
 */
export interface StreamHealthEvent {
  status: 'connected' | 'reconnecting' | 'error';
  lastLedgerSequence?: number | null;
  error?: string;
  /** Delay before the next reconnect attempt, when status is "reconnecting". */
  reconnectDelayMs?: number;
  /** Consecutive reconnect attempt number (resets on a successful connect). */
  attempt?: number;
}

export interface HorizonStreamStats {
  connected: boolean;
  lastLedgerSequence: number | null;
  cursor: string | null;
  reconnectAttempts: number;
  totalReconnects: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
}

/**
 * Maintains a persistent SSE connection to the Stellar Horizon API to receive
 * ledger close events in real time. This replaces the polling-based approach
 * with sub-second latency for event detection.
 *
 * Horizon's `/ledgers` endpoint only returns a single JSON page unless
 * `stream=true` is supplied. This service therefore:
 * - streams via `GET /ledgers?cursor=<paging_token>&order=asc&stream=true`
 * - persists the Horizon **paging token** (never a bare ledger sequence) so a
 *   restart resumes where it left off instead of re-scanning from genesis
 * - reconnects with exponential backoff on normal end-of-stream, transport
 *   errors and unexpected aborts alike
 * - logs and counts every reconnect so a flapping stream is observable
 */
@Injectable()
export class HorizonStreamService
  extends EventEmitter
  implements OnModuleDestroy
{
  private readonly logger = new Logger(HorizonStreamService.name);
  private readonly horizonUrl: string;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  private currentController: AbortController | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentReconnectDelay = 0;
  private connected = false;
  private lastLedgerSequence: number | null = null;
  /** Horizon paging token to resume from; "now" on a cold start. */
  private cursor: string | null = null;
  private stopping = false;

  /** Consecutive reconnect attempts; reset after a successful connect. */
  private reconnectAttempts = 0;
  /** Lifetime reconnect count, exposed for dashboards/metrics. */
  private totalReconnects = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly stateService: IndexingStateService,
  ) {
    super();
    this.horizonUrl =
      this.configService.get<string>('stellar.horizonUrl') ??
      'https://horizon-testnet.stellar.org';
    this.reconnectBaseMs =
      this.configService.get<number>(
        'blockchainIndexer.wsReconnectBaseDelayMs',
      ) ?? 1000;
    this.reconnectMaxMs =
      this.configService.get<number>(
        'blockchainIndexer.wsReconnectMaxDelayMs',
      ) ?? 30000;
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /**
   * Starts the SSE stream. Resumes from the last persisted paging token if
   * available, otherwise starts at "now" so a cold start never re-scans the
   * entire chain.
   */
  async start(): Promise<void> {
    if (this.currentController || this.reconnectTimer) return;
    this.stopping = false;
    this.currentReconnectDelay = 0;

    const [token, lastIndexed] = await Promise.all([
      this.stateService.getLedgerPagingToken(),
      this.stateService.getLastIndexedLedger(),
    ]);
    this.cursor = token ?? 'now';
    this.lastLedgerSequence = lastIndexed;

    this.logger.log(
      `Starting Horizon ledger stream from cursor ${this.cursor} (last indexed ledger: ${
        this.lastLedgerSequence ?? 'unknown'
      })`,
    );
    this.connect();
  }

  /**
   * Gracefully stops the SSE stream.
   */
  stop(): void {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const controller = this.currentController;
    this.currentController = null;
    controller?.abort();
    this.connected = false;
    this.logger.log('Horizon ledger stream stopped');
  }

  /**
   * Whether the stream is currently connected and receiving events.
   */
  isConnected(): boolean {
    return this.connected;
  }

  getLastLedgerSequence(): number | null {
    return this.lastLedgerSequence;
  }

  /**
   * Alias kept for callers that describe the value as the "latest" ledger.
   */
  getLatestLedgerSequence(): number | null {
    return this.lastLedgerSequence;
  }

  /**
   * The Horizon paging token the stream will resume from after a reconnect.
   */
  getLastCursor(): string | null {
    return this.cursor;
  }

  getStats(): HorizonStreamStats {
    return {
      connected: this.connected,
      lastLedgerSequence: this.lastLedgerSequence,
      cursor: this.cursor,
      reconnectAttempts: this.reconnectAttempts,
      totalReconnects: this.totalReconnects,
      reconnectBaseMs: this.reconnectBaseMs,
      reconnectMaxMs: this.reconnectMaxMs,
    };
  }

  /**
   * Manually reset the stream cursor to a specific paging token (or ledger
   * sequence, which is a valid paging token for the `/ledgers` endpoint).
   */
  async resetCursor(cursor: string | number): Promise<void> {
    const token = String(cursor);
    this.cursor = token;
    await this.stateService.setLedgerPagingToken(token);
    this.logger.log(`Stream cursor reset to ${token}`);

    // Restart the connection to pick up from the new cursor.
    if (this.currentController) {
      this.disconnect();
      this.connect();
    }
  }

  private connect(): void {
    if (this.stopping) return;

    const controller = new AbortController();
    this.currentController = controller;

    const baseUrl = this.horizonUrl.replace(/\/$/, '');
    const cursor = encodeURIComponent(this.cursor ?? 'now');
    // `stream=true` is what turns /ledgers into an SSE endpoint. Without it
    // Horizon returns a single JSON page whose shape processLine cannot match.
    const url = `${baseUrl}/ledgers?order=asc&cursor=${cursor}&stream=true`;

    this.logger.debug(`Connecting to Horizon ledger stream: ${url}`);

    // Use fetch with streaming for SSE support (Node 18+ ReadableStream).
    void this.streamLoop(url, controller);
  }

  private disconnect(): void {
    const controller = this.currentController;
    this.currentController = null;
    controller?.abort();
    this.connected = false;
  }

  private async streamLoop(
    url: string,
    controller: AbortController,
  ): Promise<void> {
    const signal = controller.signal;

    try {
      const response = await fetch(url, {
        signal,
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`Horizon responded with ${response.status}`);
      }

      this.connected = true;
      this.currentReconnectDelay = 0;
      this.reconnectAttempts = 0;
      this.emit('health', {
        status: 'connected',
        lastLedgerSequence: this.lastLedgerSequence,
      } satisfies StreamHealthEvent);

      this.logger.log(
        `Horizon ledger stream connected (cursor ${this.cursor ?? 'now'})`,
      );

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          // A normal end-of-stream is still a disconnect: fall through to the
          // shared reconnect path in `finally`.
          this.logger.warn('Horizon ledger stream ended; scheduling reconnect');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (signal.aborted) break;
          this.processLine(line);
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.logger.debug('Horizon ledger stream aborted');
      } else {
        this.logger.warn(
          `Horizon ledger stream error: ${(error as Error).message}`,
        );
        this.emit('health', {
          status: 'error',
          error: (error as Error).message,
          lastLedgerSequence: this.lastLedgerSequence ?? undefined,
        } satisfies StreamHealthEvent);
      }
    } finally {
      this.connected = false;

      // Only the active controller may schedule a reconnect. Stale loops
      // (aborted by resetCursor/disconnect) must not race the new connection.
      const isCurrent = this.currentController === controller;
      if (isCurrent) {
        this.currentController = null;
      }

      if (!this.stopping && isCurrent) {
        this.scheduleReconnect();
      }
    }
  }

  private processLine(line: string): void {
    const trimmed = line.replace(/\r$/, '');

    if (
      !trimmed ||
      trimmed.startsWith(':') ||
      trimmed.startsWith('event:') ||
      trimmed.startsWith('id:') ||
      trimmed.startsWith('retry:')
    ) {
      // SSE comments/markers — not a ledger payload.
      return;
    }

    if (!trimmed.startsWith('data:')) return;

    const jsonStr = trimmed.slice(5).trim();
    if (!jsonStr) return;

    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>;
      this.handleLedgerRecord(data);
    } catch {
      // Non-JSON or malformed data — ignore.
    }
  }

  private handleLedgerRecord(data: Record<string, unknown>): void {
    // A streamed ledger record always carries a numeric `sequence` and a
    // `hash` (also exposed as `id`). Anything else is not a ledger.
    if (typeof data.sequence !== 'number') return;

    let hash = '';
    if (typeof data.hash === 'string') {
      hash = data.hash;
    } else if (typeof data.id === 'string') {
      hash = data.id;
    }
    if (!hash) return;

    const pagingToken =
      typeof data.paging_token === 'string'
        ? data.paging_token
        : String(data.sequence);

    const ledgerEvent: LedgerCloseEvent = {
      sequence: data.sequence,
      closedAt: typeof data.closed_at === 'string' ? data.closed_at : '',
      hash,
      pagingToken,
      header: data,
    };

    this.lastLedgerSequence = ledgerEvent.sequence;
    this.cursor = pagingToken;
    this.emit('ledger', ledgerEvent);
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;

    const delay = Math.min(
      this.reconnectBaseMs * Math.pow(2, this.currentReconnectDelay),
      this.reconnectMaxMs,
    );
    this.currentReconnectDelay++;
    this.reconnectAttempts++;
    this.totalReconnects++;

    this.logger.warn(
      `Reconnecting to Horizon ledger stream in ${delay}ms (attempt ${this.reconnectAttempts}, total ${this.totalReconnects})`,
    );
    this.emit('health', {
      status: 'reconnecting',
      reconnectDelayMs: delay,
      attempt: this.reconnectAttempts,
    } satisfies StreamHealthEvent);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
