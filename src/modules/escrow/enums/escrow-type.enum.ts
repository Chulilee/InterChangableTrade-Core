export enum EscrowType {
  /** Standard m-of-n escrow for bilateral trades */
  STANDARD = 'standard',
  /** Time-locked escrow with automatic settlement on expiry */
  TIME_LOCKED = 'time_locked',
  /** Escrow with milestone-based partial releases */
  MILESTONE_BASED = 'milestone_based',
  /** Institutional trust account requiring trustee involvement */
  TRUST_ACCOUNT = 'trust_account',
}
