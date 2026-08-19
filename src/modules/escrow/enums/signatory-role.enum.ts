export enum SignatoryRole {
  /** User who initiated the escrow */
  CREATOR = 'creator',
  /** Counterparty to the trade */
  COUNTERPARTY = 'counterparty',
  /** Third-party trustee (institutional) */
  TRUSTEE = 'trustee',
  /** Institutional representative */
  INSTITUTIONAL_REP = 'institutional_rep',
  /** Platform admin (for admin-initiated settlements) */
  ADMIN = 'admin',
}
