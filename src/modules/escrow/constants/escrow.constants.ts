/** Default timeout for escrow settlement window (7 days in milliseconds) */
export const DEFAULT_SETTLEMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum number of signatories allowed on an escrow account */
export const MAX_SIGNATORIES = 10;

/** Minimum required signatures (must be >= 2 for multi-sig) */
export const MIN_REQUIRED_SIGNATURES = 2;

/** Maximum escrow amount (100 million in stroops precision) */
export const MAX_ESCROW_AMOUNT = '100000000.0000000';

/** Grace period after timeout before auto-refund (1 hour in milliseconds) */
export const TIMEOUT_GRACE_PERIOD_MS = 60 * 60 * 1000;

/** Maximum active escrows per user */
export const MAX_ACTIVE_ESCROWS_PER_USER = 50;

/** Default time-lock duration (30 days in milliseconds) */
export const DEFAULT_TIME_LOCK_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
