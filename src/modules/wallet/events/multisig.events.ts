/**
 * Event names emitted by the multi-signature signing pipeline. Payloads are
 * flat objects keyed by `transactionId` and are emitted after the owning DB
 * transaction commits (mirrors the escrow module's event convention).
 */
export class MultisigEvents {
  static readonly TRANSACTION_PROPOSED = 'multisig.transaction.proposed';
  static readonly TRANSACTION_SIGNED = 'multisig.transaction.signed';
  static readonly TRANSACTION_READY = 'multisig.transaction.ready';
  static readonly TRANSACTION_SUBMITTED = 'multisig.transaction.submitted';
  static readonly TRANSACTION_FAILED = 'multisig.transaction.failed';
}
