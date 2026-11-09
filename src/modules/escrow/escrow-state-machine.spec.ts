import { BadRequestException } from '@nestjs/common';
import { EscrowStatus } from './enums/escrow-status.enum';
import {
  ESCROW_TRANSITIONS,
  INITIAL_ESCROW_STATUS,
  assertTransition,
  canTransition,
  isApprovedForRelease,
  isMilestoneUpdatable,
} from './escrow-state-machine';

const ALL_STATUSES = Object.values(EscrowStatus);

describe('escrow state machine', () => {
  describe('ESCROW_TRANSITIONS', () => {
    it('defines an entry for every status', () => {
      expect(Object.keys(ESCROW_TRANSITIONS).sort()).toEqual(
        [...ALL_STATUSES].sort(),
      );
    });

    it('makes every status reachable from a real transition', () => {
      const targets = new Set(
        Object.values(ESCROW_TRANSITIONS).flatMap((targets) => targets),
      );

      for (const status of ALL_STATUSES) {
        const reachable =
          status === INITIAL_ESCROW_STATUS || targets.has(status);
        expect({ status, reachable }).toEqual({ status, reachable: true });
      }
    });

    it('only targets statuses that exist in the enum', () => {
      const valid = new Set(ALL_STATUSES);

      for (const targets of Object.values(ESCROW_TRANSITIONS)) {
        for (const target of targets) {
          expect(valid.has(target)).toBe(true);
        }
      }
    });

    it('leaves terminal statuses without outgoing transitions', () => {
      for (const status of [
        EscrowStatus.SETTLED,
        EscrowStatus.REFUNDED,
        EscrowStatus.CANCELLED,
      ]) {
        expect(ESCROW_TRANSITIONS[status]).toEqual([]);
      }
    });
  });

  describe('canTransition', () => {
    it('accepts a normal funding -> approval -> settlement path', () => {
      expect(
        canTransition(EscrowStatus.PENDING, EscrowStatus.FUNDED),
      ).toBe(true);
      expect(
        canTransition(EscrowStatus.FUNDED, EscrowStatus.APPROVED),
      ).toBe(true);
      expect(
        canTransition(EscrowStatus.APPROVED, EscrowStatus.PARTIALLY_RELEASED),
      ).toBe(true);
      expect(
        canTransition(
          EscrowStatus.PARTIALLY_RELEASED,
          EscrowStatus.SETTLED,
        ),
      ).toBe(true);
    });

    it('rejects jumps that skip the funding or approval steps', () => {
      expect(
        canTransition(EscrowStatus.PENDING, EscrowStatus.APPROVED),
      ).toBe(false);
      expect(
        canTransition(EscrowStatus.PENDING, EscrowStatus.SETTLED),
      ).toBe(false);
      expect(
        canTransition(EscrowStatus.FUNDED, EscrowStatus.PARTIALLY_RELEASED),
      ).toBe(false);
    });

    it('rejects transitions out of terminal statuses', () => {
      expect(
        canTransition(EscrowStatus.SETTLED, EscrowStatus.FUNDED),
      ).toBe(false);
      expect(
        canTransition(EscrowStatus.REFUNDED, EscrowStatus.SETTLED),
      ).toBe(false);
      expect(
        canTransition(EscrowStatus.CANCELLED, EscrowStatus.PENDING),
      ).toBe(false);
    });
  });

  describe('assertTransition', () => {
    it('does not throw for a legal transition', () => {
      expect(() =>
        assertTransition(EscrowStatus.FUNDED, EscrowStatus.APPROVED),
      ).not.toThrow();
    });

    it('throws BadRequestException for an illegal transition', () => {
      expect(() =>
        assertTransition(EscrowStatus.PENDING, EscrowStatus.SETTLED),
      ).toThrow(BadRequestException);
      expect(() =>
        assertTransition(EscrowStatus.PENDING, EscrowStatus.SETTLED),
      ).toThrow('pending -> settled');
    });
  });

  describe('isApprovedForRelease', () => {
    it('only allows approved or partially released escrows', () => {
      expect(isApprovedForRelease(EscrowStatus.APPROVED)).toBe(true);
      expect(isApprovedForRelease(EscrowStatus.PARTIALLY_RELEASED)).toBe(true);
      expect(isApprovedForRelease(EscrowStatus.FUNDED)).toBe(false);
      expect(isApprovedForRelease(EscrowStatus.PENDING)).toBe(false);
    });
  });

  describe('isMilestoneUpdatable', () => {
    it('allows milestone updates while the escrow is live', () => {
      expect(isMilestoneUpdatable(EscrowStatus.FUNDED)).toBe(true);
      expect(isMilestoneUpdatable(EscrowStatus.APPROVED)).toBe(true);
      expect(isMilestoneUpdatable(EscrowStatus.PARTIALLY_RELEASED)).toBe(true);
    });

    it('rejects milestone updates once the escrow is finished', () => {
      expect(isMilestoneUpdatable(EscrowStatus.SETTLED)).toBe(false);
      expect(isMilestoneUpdatable(EscrowStatus.REFUNDED)).toBe(false);
      expect(isMilestoneUpdatable(EscrowStatus.CANCELLED)).toBe(false);
    });
  });
});
