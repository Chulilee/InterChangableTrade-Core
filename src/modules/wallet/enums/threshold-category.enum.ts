/**
 * Stellar classifies each operation into a threshold category. A transaction
 * must gather signature weight meeting the account threshold of its
 * highest-category operation.
 *
 * @see https://developers.stellar.org/docs/learn/encyclopedia/security/signatures-multisig
 */
export enum ThresholdCategory {
  /** e.g. AllowTrust, BumpSequence, SetTrustLineFlags. */
  LOW = 'low',

  /** Default for most operations (Payment, ManageOffer, ChangeTrust, …). */
  MEDIUM = 'medium',

  /** SetOptions (signer/threshold changes) and AccountMerge. */
  HIGH = 'high',
}
