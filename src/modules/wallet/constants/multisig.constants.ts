/**
 * Multi-signature limits and defaults.
 *
 * These mirror Stellar's on-chain protocol constraints so DTO validation and
 * service logic agree with what the network will actually accept.
 */

/** Stellar protocol limit: an account may hold at most 20 signers. */
export const MAX_SIGNERS = 20;

/** An M-of-N policy needs at least one signer. */
export const MIN_SIGNERS = 1;

/** Per-signer weight is a uint8 on-chain (0 removes a signer). */
export const MAX_SIGNER_WEIGHT = 255;

/** Operation thresholds (low/med/high) are uint8 on-chain. */
export const MAX_THRESHOLD = 255;

/**
 * Default validity window, in seconds, for a proposed multi-sig transaction.
 * Signatures must be collected and the transaction broadcast before its
 * timebounds elapse.
 */
export const DEFAULT_MULTISIG_TX_TIMEOUT_SECS = 3600;
