import { Permission, Role } from './enums/role.enum';
import { AuthorizationAuditService } from './services/authorization-audit.service';
import { AuthorizationService } from './services/authorization.service';
import { DelegationManagerService } from './services/delegation-manager.service';
import { PolicyEngineService } from './services/policy-engine.service';
import { RoleHierarchyService } from './services/role-hierarchy.service';
import { StellarSignerService } from './services/stellar-signer.service';
import { ThresholdManagerService } from './services/threshold-manager.service';

describe('Authorization framework', () => {
  let roles: RoleHierarchyService;
  let policies: PolicyEngineService;
  let delegations: DelegationManagerService;
  let thresholds: ThresholdManagerService;
  let signers: StellarSignerService;
  let audit: AuthorizationAuditService;
  let service: AuthorizationService;

  beforeEach(() => {
    roles = new RoleHierarchyService();
    policies = new PolicyEngineService();
    delegations = new DelegationManagerService();
    thresholds = new ThresholdManagerService();
    signers = new StellarSignerService();
    audit = new AuthorizationAuditService();
    service = new AuthorizationService(
      roles,
      policies,
      delegations,
      thresholds,
      audit,
    );
  });

  describe('role hierarchy', () => {
    it('exposes more than five hierarchical roles', () => {
      expect(roles.allRoles().length).toBeGreaterThanOrEqual(6);
    });

    it('treats a more senior role as subsuming a junior one', () => {
      expect(roles.isAtLeast(Role.ADMIN, Role.TRADER)).toBe(true);
      expect(roles.isAtLeast(Role.TRADER, Role.ADMIN)).toBe(false);
    });

    it('grants admins every permission', () => {
      const granted = roles.permissionsFor([Role.ADMIN]);
      expect(granted.size).toBe(Object.values(Permission).length);
    });

    it('does not grant a trader compliance permissions', () => {
      expect(
        roles.hasPermission([Role.TRADER], Permission.COMPLIANCE_WRITE),
      ).toBe(false);
    });
  });

  describe('policy engine', () => {
    const baseRequest = {
      subjectId: 'subject-1',
      roles: [Role.TRADER],
      permission: Permission.TRADE_CREATE,
    };

    it('allows when no policy restricts the action', () => {
      const decision = policies.evaluate(baseRequest);
      expect(decision.allowed).toBe(true);
      expect(decision.matchedPolicyIds).toHaveLength(0);
    });

    it('enforces a transaction limit', () => {
      policies.registerPolicy({
        id: 'large-trades',
        effect: 'deny',
        conditions: [{ type: 'transaction-limit', maxAmount: 1_000 }],
      });

      expect(
        policies.evaluate({ ...baseRequest, amount: 500 }).allowed,
      ).toBe(true);
      expect(
        policies.evaluate({ ...baseRequest, amount: 5_000 }).allowed,
      ).toBe(false);
    });

    it('enforces a daily transaction limit', () => {
      policies.registerPolicy({
        id: 'daily-cap',
        effect: 'deny',
        conditions: [{ type: 'transaction-limit', maxDailyAmount: 10_000 }],
      });

      expect(
        policies.evaluate({ ...baseRequest, dailyAmount: 9_000 }).allowed,
      ).toBe(true);
      expect(
        policies.evaluate({ ...baseRequest, dailyAmount: 11_000 }).allowed,
      ).toBe(false);
    });

    it('enforces a time window', () => {
      policies.registerPolicy({
        id: 'trading-hours',
        effect: 'deny',
        conditions: [
          { type: 'time-window', startHour: 9, endHour: 17, daysOfWeek: [1, 2, 3, 4, 5] },
        ],
      });

      const tuesdayNoon = new Date('2024-01-02T12:00:00Z');
      const tuesdayNight = new Date('2024-01-02T22:00:00Z');
      const sundayNoon = new Date('2024-01-07T12:00:00Z');

      expect(
        policies.evaluate({ ...baseRequest, timestamp: tuesdayNoon }).allowed,
      ).toBe(true);
      expect(
        policies.evaluate({ ...baseRequest, timestamp: tuesdayNight }).allowed,
      ).toBe(false);
      expect(
        policies.evaluate({ ...baseRequest, timestamp: sundayNoon }).allowed,
      ).toBe(false);
    });

    it('enforces a token whitelist', () => {
      policies.registerPolicy({
        id: 'usdc-only',
        effect: 'deny',
        conditions: [
          { type: 'token-restriction', allowedTokens: ['USDC:GA5Z'] },
        ],
      });

      expect(
        policies.evaluate({ ...baseRequest, asset: 'USDC:GA5Z' }).allowed,
      ).toBe(true);
      expect(
        policies.evaluate({ ...baseRequest, asset: 'XLM' }).allowed,
      ).toBe(false);
    });

    it('enforces a rate limit', () => {
      policies.registerPolicy({
        id: 'rate',
        effect: 'deny',
        conditions: [{ type: 'rate-limit', maxActions: 2, windowMs: 60_000 }],
      });

      expect(
        policies.evaluate({ ...baseRequest, recentActionCount: 1 }).allowed,
      ).toBe(true);
      expect(
        policies.evaluate({ ...baseRequest, recentActionCount: 5 }).allowed,
      ).toBe(false);
    });

    it('lets a deny policy override an allow policy', () => {
      policies.registerPolicy({
        id: 'allow-all',
        effect: 'allow',
        conditions: [],
      });
      policies.registerPolicy({
        id: 'deny-xlm',
        effect: 'deny',
        conditions: [
          { type: 'token-restriction', deniedTokens: ['XLM'] },
        ],
      });

      const decision = policies.evaluate({ ...baseRequest, asset: 'XLM' });
      expect(decision.allowed).toBe(false);
      expect(decision.matchedPolicyIds).toContain('deny-xlm');
    });

    it('evaluates a complex policy set within the 10ms budget', () => {
      for (let i = 0; i < 50; i++) {
        policies.registerPolicy({
          id: `policy-${i}`,
          effect: 'deny',
          conditions: [
            { type: 'transaction-limit', maxAmount: 100_000 },
            { type: 'time-window', startHour: 0, endHour: 24 },
            { type: 'token-restriction', allowedTokens: ['USDC:GA5Z'] },
            { type: 'rate-limit', maxActions: 100, windowMs: 60_000 },
          ],
        });
      }

      const decision = policies.evaluate({
        ...baseRequest,
        amount: 100,
        asset: 'USDC:GA5Z',
      });

      expect(decision.durationMs).toBeLessThan(10);
    });
  });

  describe('delegation manager', () => {
    it('activates a delegation without an approval chain', () => {
      const delegation = delegations.createDelegation({
        delegatorId: 'boss',
        delegateeId: 'trader',
        permissions: [Permission.TRADE_CREATE],
        expiresAt: new Date(Date.now() + 60_000),
      });

      expect(delegation.status).toBe('active');
      expect(
        delegations.hasDelegatedPermission('trader', Permission.TRADE_CREATE),
      ).toBe(true);
    });

    it('keeps a delegation pending until the approval chain completes', () => {
      const delegation = delegations.createDelegation({
        delegatorId: 'boss',
        delegateeId: 'trader',
        permissions: [Permission.TRADE_CREATE],
        expiresAt: new Date(Date.now() + 60_000),
        approvalChain: ['risk', 'ops'],
      });

      expect(delegation.status).toBe('pending');
      expect(
        delegations.hasDelegatedPermission('trader', Permission.TRADE_CREATE),
      ).toBe(false);

      delegations.approveDelegation(delegation.id, 'risk');
      expect(delegation.status).toBe('pending');

      delegations.approveDelegation(delegation.id, 'ops');
      expect(delegation.status).toBe('active');
      expect(
        delegations.hasDelegatedPermission('trader', Permission.TRADE_CREATE),
      ).toBe(true);
    });

    it('rejects an approval from outside the chain', () => {
      const delegation = delegations.createDelegation({
        delegatorId: 'boss',
        delegateeId: 'trader',
        permissions: [Permission.TRADE_CREATE],
        expiresAt: new Date(Date.now() + 60_000),
        approvalChain: ['risk'],
      });

      expect(() => delegations.approveDelegation(delegation.id, 'stranger')).toThrow();
    });

    it('stops honouring a revoked delegation', () => {
      const delegation = delegations.createDelegation({
        delegatorId: 'boss',
        delegateeId: 'trader',
        permissions: [Permission.TRADE_CREATE],
        expiresAt: new Date(Date.now() + 60_000),
      });

      delegations.revokeDelegation(delegation.id, 'boss');
      expect(
        delegations.hasDelegatedPermission('trader', Permission.TRADE_CREATE),
      ).toBe(false);
    });

    it('stops honouring an expired delegation', () => {
      const delegation = delegations.createDelegation({
        delegatorId: 'boss',
        delegateeId: 'trader',
        permissions: [Permission.TRADE_CREATE],
        expiresAt: new Date(Date.now() + 1_000),
      });

      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
      expect(
        delegations.hasDelegatedPermission('trader', Permission.TRADE_CREATE),
      ).toBe(false);
      jest.restoreAllMocks();
      expect(delegation.id).toBeDefined();
    });
  });

  describe('dynamic thresholds', () => {
    beforeEach(() => {
      thresholds.configure({
        baseAmount: 1_000,
        minAmount: 1,
        maxAmount: 100_000,
        requiredSignatures: 2,
      });
    });

    it('tightens the ceiling in a volatile market', () => {
      const calm = thresholds.calculate({ volatility: 0, liquidity: 1 });
      const stormy = thresholds.calculate({ volatility: 0.8, liquidity: 1 });

      expect(stormy.maxAmount).toBeLessThan(calm.maxAmount);
      expect(stormy.requiredSignatures).toBeGreaterThan(calm.requiredSignatures);
    });

    it('raises the required signatures on high volume', () => {
      const low = thresholds.calculate({ volume: 0.1 });
      const high = thresholds.calculate({ volume: 0.9 });
      expect(high.requiredSignatures).toBe(low.requiredSignatures + 1);
    });
  });

  describe('stellar signers', () => {
    beforeEach(() => {
      signers.registerAccount({
        accountId: 'GESCROW',
        thresholdLow: 1,
        thresholdMedium: 2,
        thresholdHigh: 3,
        signers: [
          { key: 'GKEY1', weight: 1 },
          { key: 'GKEY2', weight: 2 },
          { key: 'GKEY3', weight: 3 },
        ],
      });
    });

    it('verifies collected signatures against the threshold', () => {
      const result = signers.verify(
        'GESCROW',
        [{ key: 'GKEY3', weight: 3 }],
        'high',
      );
      expect(result.valid).toBe(true);
      expect(result.weight).toBe(3);
    });

    it('reports the missing weight when below the threshold', () => {
      const result = signers.verify(
        'GESCROW',
        [{ key: 'GKEY1', weight: 1 }],
        'high',
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toBe(2);
    });

    it('ignores signatures from unknown keys', () => {
      const result = signers.verify(
        'GESCROW',
        [{ key: 'GUNKNOWN', weight: 99 }],
        'low',
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('audit trail', () => {
    it('records every decision', () => {
      service.authorize({
        subjectId: 'trader-1',
        roles: [Role.TRADER],
        permission: Permission.TRADE_CREATE,
      });
      service.authorize({
        subjectId: 'trader-1',
        roles: [Role.TRADER],
        permission: Permission.COMPLIANCE_WRITE,
      });

      const entries = audit.list();
      expect(entries).toHaveLength(2);
      expect(entries[0].decision).toBe('allow');
      expect(entries[1].decision).toBe('deny');
    });

    it('keeps the hash chain intact', () => {
      for (let i = 0; i < 5; i++) {
        service.authorize({
          subjectId: `trader-${i}`,
          roles: [Role.TRADER],
          permission: Permission.TRADE_CREATE,
        });
      }
      expect(audit.verifyChain()).toBe(true);
    });

    it('detects tampering with the chain', () => {
      service.authorize({
        subjectId: 'trader-1',
        roles: [Role.TRADER],
        permission: Permission.TRADE_CREATE,
      });
      const entries = audit.list();
      entries[0].reason = 'tampered';
      expect(audit.verifyChain()).toBe(false);
    });
  });

  describe('authorization facade', () => {
    it('allows a role permission', () => {
      const result = service.authorize({
        subjectId: 'trader-1',
        roles: [Role.TRADER],
        permission: Permission.TRADE_CREATE,
      });
      expect(result.allowed).toBe(true);
      expect(result.viaDelegation).toBe(false);
    });

    it('denies a permission the role does not hold', () => {
      const result = service.authorize({
        subjectId: 'trader-1',
        roles: [Role.TRADER],
        permission: Permission.ESCROW_RELEASE,
      });
      expect(result.allowed).toBe(false);
    });

    it('allows a delegated permission', () => {
      delegations.createDelegation({
        delegatorId: 'boss',
        delegateeId: 'trader-1',
        permissions: [Permission.ESCROW_RELEASE],
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = service.authorize({
        subjectId: 'trader-1',
        roles: [Role.TRADER],
        permission: Permission.ESCROW_RELEASE,
      });
      expect(result.allowed).toBe(true);
      expect(result.viaDelegation).toBe(true);
    });

    it('rejects an amount outside the dynamic envelope', () => {
      thresholds.configure({
        baseAmount: 1_000,
        minAmount: 1,
        maxAmount: 10_000,
        requiredSignatures: 2,
      });

      const result = service.authorizeWithThresholds({
        subjectId: 'trader-1',
        roles: [Role.TRADER],
        permission: Permission.TRADE_CREATE,
        amount: 50_000,
      });
      expect(result.allowed).toBe(false);
      expect(result.profile.maxAmount).toBe(10_000);
    });
  });
});
