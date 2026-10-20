import { Injectable, Logger } from '@nestjs/common';
import { Permission, Role } from '../enums/role.enum';
import {
  AuthorizationRequest,
  MarketConditions,
  PolicyDecision,
  ThresholdProfile,
} from '../interfaces/authorization.types';
import { AuthorizationAuditService } from './authorization-audit.service';
import { DelegationManagerService } from './delegation-manager.service';
import { PolicyEngineService } from './policy-engine.service';
import { RoleHierarchyService } from './role-hierarchy.service';
import { ThresholdManagerService } from './threshold-manager.service';

export interface AuthorizeResult extends PolicyDecision {
  /** True when the permission came from a delegation rather than a role. */
  viaDelegation: boolean;
  /** Effective permissions held by the subject at decision time. */
  effectivePermissions: Permission[];
}

/**
 * Facade over the authorization framework.
 *
 * Combines the role hierarchy, delegations, the policy engine and the dynamic
 * threshold manager into a single decision, and records every outcome in the
 * immutable audit trail.
 */
@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    private readonly roles: RoleHierarchyService,
    private readonly policies: PolicyEngineService,
    private readonly delegations: DelegationManagerService,
    private readonly thresholds: ThresholdManagerService,
    private readonly audit: AuthorizationAuditService,
  ) {}

  /**
   * Decides whether the subject may perform the requested action.
   *
   * The order is: permission (role or delegation) first, then the policy
   * engine. A denied policy always wins.
   */
  authorize(request: AuthorizationRequest): AuthorizeResult {
    const delegated = this.delegations.activePermissionsFor(request.subjectId);
    const rolePermissions = this.roles.permissionsFor(request.roles);

    const fromRole = rolePermissions.has(request.permission);
    const fromDelegation = delegated.includes(request.permission);

    if (!fromRole && !fromDelegation) {
      const decision: AuthorizeResult = {
        allowed: false,
        reason: `Subject lacks permission ${request.permission}`,
        matchedPolicyIds: [],
        evaluatedAt: request.timestamp ?? new Date(),
        durationMs: 0,
        viaDelegation: false,
        effectivePermissions: [...rolePermissions],
      };
      this.audit.record({
        actorId: request.subjectId,
        action: request.permission,
        subjectId: request.subjectId,
        decision: 'deny',
        reason: decision.reason,
        metadata: { roles: request.roles },
      });
      return decision;
    }

    const policyDecision = this.policies.evaluate({
      ...request,
      delegatedPermissions: delegated,
    });

    const result: AuthorizeResult = {
      ...policyDecision,
      viaDelegation: !fromRole && fromDelegation,
      effectivePermissions: [...new Set([...rolePermissions, ...delegated])],
    };

    this.audit.record({
      actorId: request.subjectId,
      action: request.permission,
      subjectId: request.subjectId,
      decision: result.allowed ? 'allow' : 'deny',
      reason: result.reason,
      metadata: {
        roles: request.roles,
        amount: request.amount,
        asset: request.asset,
        matchedPolicyIds: result.matchedPolicyIds,
      },
    });

    return result;
  }

  /** Convenience helper for permission checks that do not need a policy set. */
  hasPermission(roles: Role[], permission: Permission): boolean {
    return this.roles.hasPermission(roles, permission);
  }

  /**
   * Authorises an action that is subject to dynamic thresholds. The action is
   * rejected outright when the amount falls outside the dynamic envelope.
   */
  authorizeWithThresholds(
    request: AuthorizationRequest,
    conditions: MarketConditions = {},
  ): AuthorizeResult & { profile: ThresholdProfile } {
    const profile = this.thresholds.calculate(conditions);
    const amount = request.amount ?? 0;

    if (!this.thresholds.isWithinLimits(amount, profile)) {
      const decision: AuthorizeResult & { profile: ThresholdProfile } = {
        allowed: false,
        reason:
          `Amount ${amount} is outside the permitted range ` +
          `[${profile.minAmount}, ${profile.maxAmount}] (${profile.rationale})`,
        matchedPolicyIds: [],
        evaluatedAt: request.timestamp ?? new Date(),
        durationMs: 0,
        viaDelegation: false,
        effectivePermissions: [],
        profile,
      };
      this.audit.record({
        actorId: request.subjectId,
        action: request.permission,
        subjectId: request.subjectId,
        decision: 'deny',
        reason: decision.reason,
        metadata: { profile },
      });
      return decision;
    }

    const result = this.authorize(request);
    return { ...result, profile };
  }

  /** True when the amount requires more than one signature. */
  requiresMultiSignature(amount: number, profile: ThresholdProfile): boolean {
    return this.thresholds.requiresMultiSignature(amount, profile);
  }

  /** The audit trail, exposed for reporting. */
  auditTrail() {
    return this.audit.list();
  }
}
