import { BadRequestException } from '@nestjs/common';
import { EscrowStatus } from './enums/escrow-status.enum';

/**
 * Explicit escrow lifecycle (issue #95).
 *
 * Every status change in {@link EscrowService} is validated against this
 * table, so an escrow can never jump between unreachable states — the class
 * of bug that let `APPROVED` exist in fixtures but never in production.
 *
 * ```
 * PENDING ──► FUNDED ──► APPROVED ──► PARTIALLY_RELEASED ──► SETTLED
 *    │           │           │               │
 *    │           │           └──► DISPUTED ──┼──► REFUNDED
 *    │           ├──► DISPUTED ─────────────┘
 *    │           ├──► REFUNDED
 *    │           └──► EXPIRED ──► REFUNDED
 *    ├──► CANCELLED
 *    ├──► REFUNDED
 *    └──► EXPIRED ──► REFUNDED
 * ```
 *
 * `FUNDED -> SETTLED` is the time-locked auto-settlement path, which does
 * not require signatures. User-initiated releases still require an
 * `APPROVED` escrow; see {@link isApprovedForRelease}.
 */
export const INITIAL_ESCROW_STATUS = EscrowStatus.PENDING;

/** Allowed state transitions for every escrow status. */
export const ESCROW_TRANSITIONS: Readonly<
  Record<EscrowStatus, readonly EscrowStatus[]>
> = {
  [EscrowStatus.PENDING]: [
    EscrowStatus.FUNDED,
    EscrowStatus.CANCELLED,
    EscrowStatus.REFUNDED,
    EscrowStatus.EXPIRED,
  ],
  [EscrowStatus.FUNDED]: [
    EscrowStatus.APPROVED,
    EscrowStatus.DISPUTED,
    EscrowStatus.REFUNDED,
    EscrowStatus.EXPIRED,
    // Time-locked escrows auto-settle once the lock expires.
    EscrowStatus.SETTLED,
  ],
  [EscrowStatus.APPROVED]: [
    // A further signature on an already-approved escrow is a no-op
    // transition: the status stays APPROVED while the signature is recorded.
    EscrowStatus.APPROVED,
    EscrowStatus.PARTIALLY_RELEASED,
    EscrowStatus.SETTLED,
    EscrowStatus.DISPUTED,
  ],
  [EscrowStatus.PARTIALLY_RELEASED]: [
    // A second partial release keeps the escrow in PARTIALLY_RELEASED.
    EscrowStatus.PARTIALLY_RELEASED,
    EscrowStatus.SETTLED,
    EscrowStatus.DISPUTED,
  ],
  [EscrowStatus.DISPUTED]: [EscrowStatus.SETTLED, EscrowStatus.REFUNDED],
  [EscrowStatus.EXPIRED]: [EscrowStatus.REFUNDED],
  [EscrowStatus.SETTLED]: [],
  [EscrowStatus.REFUNDED]: [],
  [EscrowStatus.CANCELLED]: [],
};

/** Returns true when `from -> to` is a legal escrow transition. */
export function canTransition(
  from: EscrowStatus,
  to: EscrowStatus,
): boolean {
  return ESCROW_TRANSITIONS[from].includes(to);
}

/**
 * Asserts that `from -> to` is a legal escrow transition.
 *
 * @throws {BadRequestException} When the transition is not in the table.
 */
export function assertTransition(from: EscrowStatus, to: EscrowStatus): void {
  if (!canTransition(from, to)) {
    throw new BadRequestException(
      `Invalid escrow status transition: ${from} -> ${to}`,
    );
  }
}

/**
 * Statuses from which a non-admin may release funds.
 *
 * Admins can force-release from any status, but the target status is still
 * validated against {@link ESCROW_TRANSITIONS}.
 */
export function isApprovedForRelease(status: EscrowStatus): boolean {
  return (
    status === EscrowStatus.APPROVED ||
    status === EscrowStatus.PARTIALLY_RELEASED
  );
}

/**
 * Statuses in which milestone progress may be recorded.
 *
 * Updating a milestone does not change the escrow status, so this is a
 * mutability check rather than a transition.
 */
export function isMilestoneUpdatable(status: EscrowStatus): boolean {
  return (
    status === EscrowStatus.FUNDED ||
    status === EscrowStatus.APPROVED ||
    status === EscrowStatus.PARTIALLY_RELEASED
  );
}
