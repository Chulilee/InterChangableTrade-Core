import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

/**
 * Represents a client subscription to specific event types.
 */
export interface EventSubscription {
  /** Unique subscription ID. */
  id: string;
  /** Socket/client ID that owns this subscription. */
  clientId: string;
  /** Filtered event types. Empty array means "all events". */
  eventTypes: string[];
  /** Optional contract ID filter (Soroban events). */
  contractIds?: string[];
  /** Optional account filter. */
  accounts?: string[];
  /** Optional minimum ledger sequence. */
  fromLedger?: number;
}

/**
 * A normalized event pushed to subscribers.
 */
export interface NormalizedEventPayload {
  sequenceNumber: number;
  ledgerSequence: number;
  eventType: string;
  transactionHash: string;
  timestamp: string;
  sourceAccount: string;
  destinationAccount?: string;
  contractId?: string;
  methodName?: string;
  assetCode?: string;
  amount?: string;
  topics?: unknown[];
  value?: unknown;
  normalizedData?: Record<string, unknown>;
}

/**
 * Client-side subscription info for admin/debug endpoints.
 */
export interface SubscriptionInfo {
  id: string;
  clientId: string;
  eventTypes: string[];
  contractIds?: string[];
  accounts?: string[];
  createdAt: Date;
}

/**
 * Manages pub/sub subscriptions for real-time event distribution. Clients
 * register interest in specific event types, contract IDs, or accounts, and
 * receive only matching events through their WebSocket connection.
 *
 * This decouples the persistence pipeline from the client-facing delivery,
 * allowing independent scaling and failure isolation.
 */
@Injectable()
export class SubscriptionManager extends EventEmitter {
  private readonly logger = new Logger(SubscriptionManager.name);

  /** All active subscriptions keyed by subscription ID. */
  private readonly subscriptions = new Map<string, EventSubscription>();

  /** Reverse index: clientId → Set of subscription IDs for fast cleanup. */
  private readonly clientIndex = new Map<string, Set<string>>();

  private nextId = 1;

  /**
   * Creates a new subscription and returns its ID.
   */
  subscribe(subscription: Omit<EventSubscription, 'id'>): string {
    const id = `sub_${this.nextId++}`;
    const full: EventSubscription = { ...subscription, id };

    this.subscriptions.set(id, full);

    // Maintain reverse index.
    if (!this.clientIndex.has(subscription.clientId)) {
      this.clientIndex.set(subscription.clientId, new Set());
    }
    this.clientIndex.get(subscription.clientId)!.add(id);

    this.logger.debug(
      `Subscription ${id} created for client ${subscription.clientId} ` +
        `(types: ${full.eventTypes.length > 0 ? full.eventTypes.join(',') : 'all'})`,
    );

    return id;
  }

  /**
   * Removes a subscription by ID.
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    this.subscriptions.delete(subscriptionId);
    const clientSubs = this.clientIndex.get(sub.clientId);
    if (clientSubs) {
      clientSubs.delete(subscriptionId);
      if (clientSubs.size === 0) {
        this.clientIndex.delete(sub.clientId);
      }
    }

    this.logger.debug(`Subscription ${subscriptionId} removed`);
    return true;
  }

  /**
   * Removes all subscriptions for a disconnected client.
   */
  removeClientSubscriptions(clientId: string): number {
    const clientSubs = this.clientIndex.get(clientId);
    if (!clientSubs || clientSubs.size === 0) return 0;

    const count = clientSubs.size;
    for (const subId of clientSubs) {
      this.subscriptions.delete(subId);
    }
    this.clientIndex.delete(clientId);

    this.logger.debug(
      `Removed ${count} subscriptions for disconnected client ${clientId}`,
    );
    return count;
  }

  /**
   * Filters and distributes an event to matching subscriptions.
   * Returns the list of subscription IDs that received the event.
   */
  distributeEvent(event: NormalizedEventPayload): string[] {
    const matchedSubscriptions: string[] = [];

    for (const [, sub] of this.subscriptions) {
      if (this.matchesSubscription(event, sub)) {
        matchedSubscriptions.push(sub.id);
        this.emit(`event:${sub.clientId}`, {
          subscriptionId: sub.id,
          event,
        });
      }
    }

    return matchedSubscriptions;
  }

  /**
   * Returns all subscriptions, optionally filtered by client ID.
   */
  listSubscriptions(clientId?: string): SubscriptionInfo[] {
    const results: SubscriptionInfo[] = [];

    for (const [, sub] of this.subscriptions) {
      if (clientId && sub.clientId !== clientId) continue;
      results.push({
        id: sub.id,
        clientId: sub.clientId,
        eventTypes: sub.eventTypes,
        contractIds: sub.contractIds,
        accounts: sub.accounts,
        createdAt: new Date(), // tracked in-memory, not persisted
      });
    }

    return results;
  }

  /**
   * Returns the total number of active subscriptions.
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Returns the number of unique connected clients.
   */
  getClientCount(): number {
    return this.clientIndex.size;
  }

  /**
   * Checks whether an event matches a subscription's filters.
   */
  private matchesSubscription(
    event: NormalizedEventPayload,
    sub: EventSubscription,
  ): boolean {
    // Event type filter.
    if (
      sub.eventTypes.length > 0 &&
      !sub.eventTypes.includes(event.eventType)
    ) {
      return false;
    }

    // Contract ID filter.
    if (sub.contractIds && sub.contractIds.length > 0) {
      if (!event.contractId || !sub.contractIds.includes(event.contractId)) {
        return false;
      }
    }

    // Account filter (matches source or destination).
    if (sub.accounts && sub.accounts.length > 0) {
      const matchesAccount =
        sub.accounts.includes(event.sourceAccount) ||
        (event.destinationAccount &&
          sub.accounts.includes(event.destinationAccount));
      if (!matchesAccount) {
        return false;
      }
    }

    // Ledger range filter.
    if (sub.fromLedger !== undefined && event.ledgerSequence < sub.fromLedger) {
      return false;
    }

    return true;
  }
}
