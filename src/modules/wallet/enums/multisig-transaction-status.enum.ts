/**
 * Lifecycle of a pooled multi-signature transaction as signatures are
 * collected and the transaction is broadcast.
 */
export enum MultisigTransactionStatus {
  /** Awaiting more signatures before the weight threshold is met. */
  PENDING_SIGNATURES = 'pending_signatures',

  /** Accumulated signature weight meets the threshold; ready to broadcast. */
  READY = 'ready',

  /** Successfully submitted to the network. */
  SUBMITTED = 'submitted',

  /** Submission was rejected by the network. */
  FAILED = 'failed',

  /** The transaction's timebounds elapsed before it was broadcast. */
  EXPIRED = 'expired',

  /** Cancelled by the proposer before broadcast. */
  CANCELLED = 'cancelled',
}
