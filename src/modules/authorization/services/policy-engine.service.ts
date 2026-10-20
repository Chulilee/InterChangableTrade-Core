import { Injectable, Logger } from '@nestjs/common';
import {
  AuthorizationRequest,
  Policy,
  PolicyCondition,
  PolicyDecision,
  RateLimitCondition,
  TimeWindowCondition,
  TokenRestrictionCondition,
  TransactionLimitCondition,
} from '../interfaces/authorization.types';

interface ActionCounter {
  count: number;
  windowStart: number;
}

/**
 * Declarative policy engine.
 *
 * Policies are registered at runtime and composed: a policy matches only when
 * *all* of its conditions hold, and a matching `deny` policy always beats a
 * matching `allow` policy. Evaluation is in-memory and allocation-light so a
 * complex rule set resolves in well under 10ms.
 */
@Injectable()
export class PolicyEngineService {
  private readonly logger = new Logger(PolicyEngineService.name);
  private readonly policies = new Map<string, Policy>();
  private readonly actionCounters = new Map<string, ActionCounter>();

  registerPolicy(policy: Policy): void {
    this.policies.set(policy.id, policy);
  }

  registerPolicies(policies: Policy[]): void {
    for (const policy of policies) {
      this.registerPolicy(policy);
    }
  }

  removePolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  getPolicy(policyId: string): Policy | undefined {
    return this.policies.get(policyId);
  }

  listPolicies(): Policy[] {
    return [...this.policies.values()];
  }

  /** Records that a subject performed an action, for rate-limit conditions. */
  recordAction(subjectId: string, windowMs = 60_000): void {
    const now = Date.now();
    const counter = this.actionCounters.get(subjectId);
    if (!counter || now - counter.windowStart >= windowMs) {
      this.actionCounters.set(subjectId, { count: 1, windowStart: now });
      return;
    }
    counter.count += 1;
  }

  /** Number of actions recorded for a subject inside the current window. */
  recentActionCount(subjectId: string, windowMs = 60_000): number {
    const counter = this.actionCounters.get(subjectId);
    if (!counter) return 0;
    if (Date.now() - counter.windowStart >= windowMs) return 0;
    return counter.count;
  }

  /** Evaluates a request against every applicable policy. */
  evaluate(request: AuthorizationRequest): PolicyDecision {
    const startedAt = process.hrtime.bigint();
    const at = request.timestamp ?? new Date();

    const matched: Policy[] = [];
    for (const policy of this.policies.values()) {
      if (!this.appliesTo(policy, request)) continue;
      if (this.matches(policy.conditions, request, at)) {
        matched.push(policy);
      }
    }

    const denied = matched.filter((policy) => policy.effect === 'deny');
    const allowed = matched.filter((policy) => policy.effect === 'allow');

    let decision: PolicyDecision;
    if (denied.length > 0) {
      decision = {
        allowed: false,
        reason: `Denied by policy: ${denied.map((p) => p.id).join(', ')}`,
        matchedPolicyIds: matched.map((p) => p.id),
        evaluatedAt: at,
        durationMs: 0,
      };
    } else if (allowed.length > 0) {
      decision = {
        allowed: true,
        reason: `Allowed by policy: ${allowed.map((p) => p.id).join(', ')}`,
        matchedPolicyIds: matched.map((p) => p.id),
        evaluatedAt: at,
        durationMs: 0,
      };
    } else {
      decision = {
        allowed: true,
        reason: 'No policy restrictions applied',
        matchedPolicyIds: [],
        evaluatedAt: at,
        durationMs: 0,
      };
    }

    decision.durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    if (decision.durationMs > 10) {
      this.logger.warn(
        `Policy evaluation took ${decision.durationMs.toFixed(2)}ms, exceeding the 10ms budget`,
      );
    }

    return decision;
  }

  private appliesTo(policy: Policy, request: AuthorizationRequest): boolean {
    if (!policy.appliesToRoles || policy.appliesToRoles.length === 0) {
      return true;
    }
    return policy.appliesToRoles.some((role) => request.roles.includes(role));
  }

  private matches(
    conditions: PolicyCondition[],
    request: AuthorizationRequest,
    at: Date,
  ): boolean {
    return conditions.every((condition) =>
      this.matchesCondition(condition, request, at),
    );
  }

  private matchesCondition(
    condition: PolicyCondition,
    request: AuthorizationRequest,
    at: Date,
  ): boolean {
    switch (condition.type) {
      case 'time-window':
        return this.matchesTimeWindow(condition, at);
      case 'transaction-limit':
        return this.matchesTransactionLimit(condition, request);
      case 'token-restriction':
        return this.matchesTokenRestriction(condition, request);
      case 'rate-limit':
        return this.matchesRateLimit(condition, request);
      default:
        return false;
    }
  }

  private matchesTimeWindow(
    condition: TimeWindowCondition,
    at: Date,
  ): boolean {
    if (
      condition.daysOfWeek &&
      condition.daysOfWeek.length > 0 &&
      !condition.daysOfWeek.includes(at.getUTCDay())
    ) {
      return false;
    }
    const hour = at.getUTCHours();
    if (condition.startHour === condition.endHour) {
      return true; // covers the full day
    }
    if (condition.startHour < condition.endHour) {
      return hour >= condition.startHour && hour < condition.endHour;
    }
    // Window wraps past midnight.
    return hour >= condition.startHour || hour < condition.endHour;
  }

  private matchesTransactionLimit(
    condition: TransactionLimitCondition,
    request: AuthorizationRequest,
  ): boolean {
    const amount = request.amount ?? 0;
    if (condition.minAmount !== undefined && amount < condition.minAmount) {
      return false;
    }
    if (condition.maxAmount !== undefined && amount > condition.maxAmount) {
      return false;
    }
    if (
      condition.maxDailyAmount !== undefined &&
      (request.dailyAmount ?? 0) > condition.maxDailyAmount
    ) {
      return false;
    }
    return true;
  }

  private matchesTokenRestriction(
    condition: TokenRestrictionCondition,
    request: AuthorizationRequest,
  ): boolean {
    const token = request.tokenPair ?? request.asset;
    if (
      condition.deniedTokens &&
      condition.deniedTokens.length > 0 &&
      token &&
      condition.deniedTokens.includes(token)
    ) {
      return false;
    }
    if (condition.allowedTokens && condition.allowedTokens.length > 0) {
      if (!token) return false;
      const allowed = condition.allowedTokens.some((entry) => {
        if (entry === token) return true;
        // `CODE` matches any issuer of that asset code.
        const code = token.split(':')[0];
        return entry === code;
      });
      if (!allowed) return false;
    }
    return true;
  }

  private matchesRateLimit(
    condition: RateLimitCondition,
    request: AuthorizationRequest,
  ): boolean {
    const tracked = this.recentActionCount(
      request.subjectId,
      condition.windowMs,
    );
    const reported = request.recentActionCount ?? 0;
    return Math.max(tracked, reported) < condition.maxActions;
  }
}
