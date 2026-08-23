/**
 * All events that can trigger webhook deliveries.
 * External integrators subscribe to one or more of these events.
 */
export enum WebhookEvent {
  // Trade events
  TRADE_CREATED = 'trade.created',
  TRADE_COMPLETED = 'trade.completed',
  TRADE_CANCELLED = 'trade.cancelled',
  TRADE_FAILED = 'trade.failed',

  // Settlement events
  SETTLEMENT_INITIATED = 'settlement.initiated',
  SETTLEMENT_COMPLETED = 'settlement.completed',
  SETTLEMENT_FAILED = 'settlement.failed',

  // Balance events
  BALANCE_CHANGED = 'balance.changed',
  BALANCE_LOW = 'balance.low',

  // Escrow events
  ESCROW_CREATED = 'escrow.created',
  ESCROW_FUNDED = 'escrow.funded',
  ESCROW_RELEASED = 'escrow.released',
  ESCROW_DISPUTED = 'escrow.disputed',
  ESCROW_RESOLVED = 'escrow.resolved',

  // Transaction events
  TRANSACTION_INITIATED = 'transaction.initiated',
  TRANSACTION_CONFIRMED = 'transaction.confirmed',
  TRANSACTION_FAILED = 'transaction.failed',

  // Wallet events
  WALLET_CREATED = 'wallet.created',
  WALLET_UPDATED = 'wallet.updated',

  // User events
  USER_REGISTERED = 'user.registered',
  USER_KYC_COMPLETED = 'user.kyc_completed',
  USER_KYC_FAILED = 'user.kyc_failed',

  // Compliance events
  AML_FLAG_CREATED = 'compliance.aml.flag_created',
  AML_FLAG_REVIEWED = 'compliance.aml.flag_reviewed',

  // Marketplace events
  ASSET_LISTED = 'marketplace.asset_listed',
  ASSET_SOLD = 'marketplace.asset_sold',
  ASSET_DELISTED = 'marketplace.asset_delisted',

  // Notification events
  NOTIFICATION_SENT = 'notification.sent',
  NOTIFICATION_FAILED = 'notification.failed',
}
