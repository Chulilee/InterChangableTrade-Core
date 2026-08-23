import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhookDeliveryService } from './services/webhook-delivery.service';
import { WebhookEvent } from './enums/webhook-event.enum';

/**
 * Listens to platform-wide events and routes them to matching webhook subscriptions.
 *
 * Each @OnEvent handler maps a specific platform event to its webhook event type
 * and forwards the payload to the delivery service.
 */
@Injectable()
export class WebhookEventListener {
  private readonly logger = new Logger(WebhookEventListener.name);

  constructor(private readonly deliveryService: WebhookDeliveryService) {}

  // ─── Trade Events ────────────────────────────────────────────────────

  @OnEvent('trade.created')
  async handleTradeCreated(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.TRADE_CREATED, payload);
  }

  @OnEvent('trade.completed')
  async handleTradeCompleted(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.TRADE_COMPLETED, payload);
  }

  @OnEvent('trade.cancelled')
  async handleTradeCancelled(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.TRADE_CANCELLED, payload);
  }

  @OnEvent('trade.failed')
  async handleTradeFailed(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.TRADE_FAILED, payload);
  }

  // ─── Settlement Events ───────────────────────────────────────────────

  @OnEvent('settlement.initiated')
  async handleSettlementInitiated(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.SETTLEMENT_INITIATED, payload);
  }

  @OnEvent('settlement.completed')
  async handleSettlementCompleted(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.SETTLEMENT_COMPLETED, payload);
  }

  @OnEvent('settlement.failed')
  async handleSettlementFailed(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.SETTLEMENT_FAILED, payload);
  }

  // ─── Balance Events ──────────────────────────────────────────────────

  @OnEvent('balance.changed')
  async handleBalanceChanged(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.BALANCE_CHANGED, payload);
  }

  @OnEvent('balance.low')
  async handleBalanceLow(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.BALANCE_LOW, payload);
  }

  // ─── Escrow Events ──────────────────────────────────────────────────

  @OnEvent('escrow.created')
  async handleEscrowCreated(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.ESCROW_CREATED, payload);
  }

  @OnEvent('escrow.funded')
  async handleEscrowFunded(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.ESCROW_FUNDED, payload);
  }

  @OnEvent('escrow.released')
  async handleEscrowReleased(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.ESCROW_RELEASED, payload);
  }

  @OnEvent('escrow.disputed')
  async handleEscrowDisputed(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.ESCROW_DISPUTED, payload);
  }

  @OnEvent('escrow.resolved')
  async handleEscrowResolved(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.ESCROW_RESOLVED, payload);
  }

  // ─── Transaction Events ──────────────────────────────────────────────

  @OnEvent('transaction.initiated')
  async handleTransactionInitiated(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.TRANSACTION_INITIATED, payload);
  }

  @OnEvent('transaction.confirmed')
  async handleTransactionConfirmed(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.TRANSACTION_CONFIRMED, payload);
  }

  @OnEvent('transaction.failed')
  async handleTransactionFailed(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.TRANSACTION_FAILED, payload);
  }

  // ─── Wallet Events ──────────────────────────────────────────────────

  @OnEvent('wallet.created')
  async handleWalletCreated(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.WALLET_CREATED, payload);
  }

  @OnEvent('wallet.updated')
  async handleWalletUpdated(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.WALLET_UPDATED, payload);
  }

  // ─── User Events ────────────────────────────────────────────────────

  @OnEvent('user.registered')
  async handleUserRegistered(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.USER_REGISTERED, payload);
  }

  @OnEvent('user.kyc_completed')
  async handleUserKycCompleted(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.USER_KYC_COMPLETED, payload);
  }

  @OnEvent('user.kyc_failed')
  async handleUserKycFailed(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.USER_KYC_FAILED, payload);
  }

  // ─── Compliance Events ──────────────────────────────────────────────

  @OnEvent('compliance.aml.flag_created')
  async handleAmlFlagCreated(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.AML_FLAG_CREATED, payload);
  }

  @OnEvent('compliance.aml.flag_reviewed')
  async handleAmlFlagReviewed(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.AML_FLAG_REVIEWED, payload);
  }

  // ─── Marketplace Events ─────────────────────────────────────────────

  @OnEvent('marketplace.asset_listed')
  async handleAssetListed(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.ASSET_LISTED, payload);
  }

  @OnEvent('marketplace.asset_sold')
  async handleAssetSold(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.ASSET_SOLD, payload);
  }

  @OnEvent('marketplace.asset_delisted')
  async handleAssetDelisted(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.ASSET_DELISTED, payload);
  }

  // ─── Notification Events ────────────────────────────────────────────

  @OnEvent('notification.sent')
  async handleNotificationSent(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.NOTIFICATION_SENT, payload);
  }

  @OnEvent('notification.failed')
  async handleNotificationFailed(payload: Record<string, unknown>) {
    await this.dispatch(WebhookEvent.NOTIFICATION_FAILED, payload);
  }

  // ─── Helper ──────────────────────────────────────────────────────────

  private async dispatch(
    eventType: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deliveryService.processEvent(eventType, payload);
    } catch (error) {
      this.logger.error(
        `Failed to dispatch webhook for ${eventType}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
