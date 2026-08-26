export class EscrowEvents {
  static readonly ESCROW_CREATED = 'escrow.created';
  static readonly ESCROW_FUNDED = 'escrow.funded';
  static readonly ESCROW_APPROVED = 'escrow.approved';
  static readonly ESCROW_SETTLED = 'escrow.settled';
  static readonly ESCROW_REFUNDED = 'escrow.refunded';
  static readonly ESCROW_EXPIRED = 'escrow.expired';
  static readonly ESCROW_CANCELLED = 'escrow.cancelled';
  static readonly ESCROW_DISPUTED = 'escrow.disputed';
  static readonly SIGNATURE_THRESHOLD_REACHED =
    'escrow.signature_threshold_reached';
  static readonly MILESTONE_COMPLETED = 'escrow.milestone_completed';
  static readonly PARTIAL_RELEASE = 'escrow.partial_release';
}
