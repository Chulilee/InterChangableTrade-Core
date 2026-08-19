export enum EscrowStatus {
  /** Initial state — account created but not yet funded */
  PENDING = 'pending',
  /** Signatories configured, awaiting funding */
  AWAITING_FUNDING = 'awaiting_funding',
  /** Funds deposited, awaiting required signatures */
  FUNDED = 'funded',
  /** All signatures collected, ready for settlement */
  APPROVED = 'approved',
  /** Funds partially released per milestones */
  PARTIALLY_RELEASED = 'partially_released',
  /** Fully settled — funds distributed */
  SETTLED = 'settled',
  /** Funds returned to creator (timeout or cancellation) */
  REFUNDED = 'refunded',
  /** Dispute raised, escrow frozen */
  DISPUTED = 'disputed',
  /** Settlement window expired without agreement */
  EXPIRED = 'expired',
  /** Cancelled by authorized party before funding */
  CANCELLED = 'cancelled',
}
