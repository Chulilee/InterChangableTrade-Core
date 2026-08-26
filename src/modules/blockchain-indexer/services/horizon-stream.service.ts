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
  header: Record<string, unknown>;
}

/**
 * Emitted when the stream health status changes.
 */
export interface StreamHealthEvent {
  status: 'connected' | 'reconnecting' | 'error';
  lastLedgerSequence?: number | null;
  error?: string;
}

/**
 * Maintains a persistent SSE connection to the Stellar Horizon API to receive
 * ledger close events in real time. This replaces the polling-based approach
 * with sub-second latency for event detection.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Health status tracking and event emission
 * - Resumable streams via cursor tracking
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
  private stopping = false;

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
   * Starts the SSE stream. Resumes from the last known cursor if available.
   */
  async start(): Promise<void> {
    if (this.currentController) return;
    this.stopping = false;
    this.currentReconnectDelay = 0;

    const cursor = await this.stateService.getLastLedgerCursor();
    this.lastLedgerSequence = cursor ? Number(cursor) : null;

    this.logger.log(
      `Starting Horizon SSE stream from ledger ${this.lastLedgerSequence ?? 'latest'}`,
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
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
    this.connected = false;
    this.logger.log('Horizon SSE stream stopped');
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
   * Manually reset the stream cursor to a specific ledger sequence.
   */
  async resetCursor(sequence: number): Promise<void> {
    this.lastLedgerSequence = sequence;
    await this.stateService.setLedgerCursor(String(sequence));
    this.logger.log(`Stream cursor reset to ledger ${sequence}`);
    // Restart the connection to pick up from the new cursor.
    if (this.connected) {
      this.disconnect();
      this.connect();
    }
  }

  private connect(): void {
    if (this.stopping) return;

    this.currentController = new AbortController();
    const baseUrl = this.horizonUrl.replace(/\/$/, '');
    const cursor = this.lastLedgerSequence
      ? `cursor=${this.lastLedgerSequence}`
      : '';
    const url = `${baseUrl}/ledgers?order=asc&limit=200${cursor ? `&${cursor}` : ''}`;

    this.logger.debug(`Connecting to Horizon SSE: ${url}`);

    // Use fetch with streaming for SSE support (Node 18+ ReadableStream).
    void this.streamLoop(url, this.currentController.signal);
  }

  private disconnect(): void {
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
    this.connected = false;
  }

  private async streamLoop(url: string, signal: AbortSignal): Promise<void> {
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
      this.emit('health', {
        status: 'connected',
        lastLedgerSequence: this.lastLedgerSequence,
      } satisfies StreamHealthEvent);

      this.logger.log('Horizon SSE stream connected');

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

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
        this.logger.debug('Horizon SSE stream aborted');
        return;
      }

      this.logger.warn(`Horizon SSE stream error: ${(error as Error).message}`);
      this.connected = false;
      this.emit('health', {
        status: 'error',
        error: (error as Error).message,
        lastLedgerSequence: this.lastLedgerSequence ?? undefined,
      } satisfies StreamHealthEvent);

      if (!this.stopping) {
        this.scheduleReconnect();
      }
    }
  }

  private processLine(line: string): void {
    if (line.startsWith('event:')) {
      // SSE event type marker — Horizon sends "event: ledgers" for ledger events.
      return;
    }

    if (!line.startsWith('data:')) return;

    const jsonStr = line.slice(5).trim();
    if (!jsonStr) return;

    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>;

      // Filter for ledger close events only.
      if (
        data.type !== 'ledger' &&
        data._links &&
        typeof data.sequence === 'number'
      ) {
        // This is a ledger record.
        const ledgerEvent: LedgerCloseEvent = {
          sequence: data.sequence as number,
          closedAt: (data.closed_at as string) ?? '',
          hash: (data.hash as string) ?? '',
          header: data,
        };

        this.lastLedgerSequence = ledgerEvent.sequence;
        this.emit('ledger', ledgerEvent);
      }
    } catch {
      // Non-JSON or malformed data — ignore.
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;

    const delay = Math.min(
      this.reconnectBaseMs * Math.pow(2, this.currentReconnectDelay),
      this.reconnectMaxMs,
    );
    this.currentReconnectDelay++;

    this.logger.log(
      `Reconnecting to Horizon SSE in ${delay}ms (attempt ${this.currentReconnectDelay})`,
    );
    this.emit('health', {
      status: 'reconnecting',
    } satisfies StreamHealthEvent);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
