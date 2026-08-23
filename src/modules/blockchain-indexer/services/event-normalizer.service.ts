import { Injectable, Logger } from '@nestjs/common';
import {
  BlockchainEventType,
} from '../entities/blockchain-event.entity';
import { IndexedEvent } from '../entities/indexed-event.entity';
import {
  RawTransaction,
  RawOperation,
} from './stellar-event-source.service';
import { ParsedContractEvent } from '../../stellar/soroban/soroban.types';

/**
 * Full event ready for persistence (has all required fields including sequenceNumber).
 */
export type IndexedEventInput = Omit<
  IndexedEvent,
  'id' | 'createdAt' | 'updatedAt'
>;

/**
 * Event with sequenceNumber not yet assigned (returned by normalizer methods).
 */
export type UnsequencedEvent = Omit<IndexedEventInput, 'sequenceNumber'> & {
  sequenceNumber?: string;
};

/**
 * Normalizes raw Stellar operations and Soroban contract events into a unified
 * {@link IndexedEvent} shape. This keeps the rest of the indexer pipeline free
 * of SDK-specific types and makes cross-cutting queries possible.
 */
@Injectable()
export class EventNormalizer {
  private readonly logger = new Logger(EventNormalizer.name);
  private sequenceCounter = BigInt(0);

  /**
   * Initializes the sequence counter from the persisted high-water mark.
   * Must be called once during startup before normalizing any events.
   */
  initializeSequenceCounter(from: bigint): void {
    this.sequenceCounter = from;
    this.logger.log(`Sequence counter initialized at ${from}`);
  }

  getNextSequence(): bigint {
    this.sequenceCounter += BigInt(1);
    return this.sequenceCounter;
  }

  getCurrentSequence(): bigint {
    return this.sequenceCounter;
  }

  /**
   * Converts Stellar native operations into normalized event inputs.
   * Returns events without sequence numbers — caller must use assignSequence().
   */
  normalizeStellarOperations(
    tx: RawTransaction,
    operations: RawOperation[],
  ): UnsequencedEvent[] {
    const results: UnsequencedEvent[] = [];

    for (const op of operations) {
      const eventType = this.mapOperationType(op.type);
      if (!eventType) continue;

      results.push({
        ledgerSequence: tx.ledger,
        eventType,
        transactionHash: tx.hash,
        timestamp: new Date(tx.created_at),
        sourceAccount: op.from ?? tx.source_account,
        destinationAccount: this.resolveDestination(op),
        assetCode: op.asset_code ?? 'native',
        assetIssuer: op.asset_issuer,
        amount: op.amount ?? op.starting_balance ?? undefined,
        raw: { operation: op, transaction: { hash: tx.hash, ledger: tx.ledger } },
        invalidated: false,
      });
    }

    return results;
  }

  /**
   * Converts a Soroban contract event into a normalized event input.
   * Returns events without sequence numbers — caller must use assignSequence().
   */
  normalizeSorobanEvent(
    sorobanEvent: ParsedContractEvent,
  ): UnsequencedEvent {
    const eventType = this.mapSorobanEventType(sorobanEvent.type);

    return {
      ledgerSequence: sorobanEvent.ledger,
      eventType,
      transactionHash: sorobanEvent.txHash,
      timestamp: new Date(sorobanEvent.ledgerClosedAt),
      sourceAccount: sorobanEvent.contractId,
      contractId: sorobanEvent.contractId,
      methodName: this.extractMethodName(sorobanEvent.topics),
      topics: sorobanEvent.topics,
      value: sorobanEvent.value,
      normalizedData: {
        sorobanId: sorobanEvent.id,
        pagingToken: sorobanEvent.pagingToken,
        eventType: sorobanEvent.type,
      },
      raw: {
        id: sorobanEvent.id,
        pagingToken: sorobanEvent.pagingToken,
        indexedAt: sorobanEvent.indexedAt,
      },
      invalidated: false,
    };
  }

  /**
   * Batch-converts Soroban events.
   */
  normalizeSorobanEvents(
    events: ParsedContractEvent[],
  ): UnsequencedEvent[] {
    return events.map((e) => this.normalizeSorobanEvent(e));
  }

  /**
   * Builds a complete IndexedEvent ready for persistence, assigning sequence numbers.
   */
  assignSequence(
    input: UnsequencedEvent,
  ): IndexedEventInput {
    return {
      ...input,
      sequenceNumber: this.getNextSequence().toString(),
    } as IndexedEventInput;
  }

  private mapOperationType(
    horizonType: string,
  ): BlockchainEventType | null {
    const mapping: Record<string, BlockchainEventType> = {
      payment: BlockchainEventType.PAYMENT,
      path_payment_strict_receive:
        BlockchainEventType.PATH_PAYMENT_STRICT_RECEIVE,
      path_payment_strict_send: BlockchainEventType.PATH_PAYMENT_STRICT_SEND,
      manage_offer: BlockchainEventType.MANAGE_OFFER,
      create_account: BlockchainEventType.CREATE_ACCOUNT,
      account_merge: BlockchainEventType.ACCOUNT_MERGE,
    };

    return mapping[horizonType] ?? null;
  }

  private mapSorobanEventType(
    sorobanType: string,
  ): BlockchainEventType {
    switch (sorobanType) {
      case 'contract':
        return BlockchainEventType.SOROBAN_CONTRACT_EVENT;
      case 'system':
        return BlockchainEventType.SOROBAN_SYSTEM_EVENT;
      case 'diagnostic':
        return BlockchainEventType.SOROBAN_DIAGNOSTIC_EVENT;
      default:
        return BlockchainEventType.SOROBAN_CONTRACT_EVENT;
    }
  }

  private resolveDestination(op: RawOperation): string | undefined {
    return op.to ?? op.into;
  }

  private extractMethodName(topics: unknown[]): string | undefined {
    if (!topics || topics.length === 0) return undefined;
    const first = topics[0];
    return typeof first === 'string' ? first : String(first);
  }
}
