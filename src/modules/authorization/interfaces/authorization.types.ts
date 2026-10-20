import { Permission, Role } from '../enums/role.enum';

/** Effect of a policy when it matches. Deny always wins over allow. */
export type PolicyEffect = 'allow' | 'deny';

/** Restricts an action to a time window (UTC hours, 0 = Sunday). */
export interface TimeWindowCondition {
  type: 'time-window';
  startHour: number;
  endHour: number;
  daysOfWeek?: number[];
}

/** Restricts an action by value. */
export interface TransactionLimitCondition {
  type: 'transaction-limit';
  minAmount?: number;
  maxAmount?: number;
  maxDailyAmount?: number;
}

/** Restricts an action to a whitelist (or blacklist) of tokens. */
export interface TokenRestrictionCondition {
  type: 'token-restriction';
  allowedTokens?: string[];
  deniedTokens?: string[];
}

/** Restricts how many times an action may be performed in a window. */
export interface RateLimitCondition {
  type: 'rate-limit';
  maxActions: number;
  windowMs: number;
}

export type PolicyCondition =
  | TimeWindowCondition
  | TransactionLimitCondition
  | TokenRestrictionCondition
  | RateLimitCondition;

/** A single, composable rule. All of its conditions must hold for it to match. */
export interface Policy {
  id: string;
  description?: string;
  effect: PolicyEffect;
  conditions: PolicyCondition[];
  /** When present, the policy only applies to these roles. */
  appliesToRoles?: Role[];
}

/** Everything the policy engine needs to decide on a single action. */
export interface AuthorizationRequest {
  subjectId: string;
  roles: Role[];
  permission: Permission;
  amount?: number;
  asset?: string;
  tokenPair?: string;
  timestamp?: Date;
  /** Number of actions the subject performed in the current window. */
  recentActionCount?: number;
  /** Amount the subject has already moved today. */
  dailyAmount?: number;
  /** Permissions held through a delegation. */
  delegatedPermissions?: Permission[];
}

/** The outcome of evaluating a request against the policy set. */
export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  matchedPolicyIds: string[];
  evaluatedAt: Date;
  durationMs: number;
}

/** Delegated authority that has not yet met its approval chain. */
export type DelegationStatus = 'pending' | 'active' | 'revoked' | 'expired';

export interface Delegation {
  id: string;
  delegatorId: string;
  delegateeId: string;
  permissions: Permission[];
  expiresAt: Date;
  status: DelegationStatus;
  /** Identifiers that must approve before the delegation activates. */
  approvalChain: string[];
  /** Identifiers that have already approved. */
  approvals: string[];
  createdAt: Date;
}

/** Market state that shifts the dynamic thresholds applied to high-value actions. */
export interface MarketConditions {
  /** 0 (calm) → 1 (extreme). */
  volatility?: number;
  /** 0 (thin) → 1 (deep). */
  liquidity?: number;
  /** 0 (low) → 1 (high). */
  volume?: number;
}

/** Thresholds derived from the base configuration and the current market. */
export interface ThresholdProfile {
  baseAmount: number;
  minAmount: number;
  maxAmount: number;
  requiredSignatures: number;
  rationale: string;
}

/** Stellar account signer configuration used for on-chain authorisation. */
export interface StellarSignerConfig {
  accountId: string;
  thresholdLow: number;
  thresholdMedium: number;
  thresholdHigh: number;
  signers: Array<{ key: string; weight: number; type?: string }>;
}

/** A signature collected for a Stellar multisig account. */
export interface CollectedSignature {
  key: string;
  weight: number;
}

/** An immutable, hash-chained record of an authorisation decision. */
export interface AuthorizationAuditEntry {
  id: string;
  sequence: number;
  timestamp: Date;
  actorId: string;
  action: string;
  subjectId?: string;
  decision: 'allow' | 'deny';
  reason: string;
  metadata: Record<string, unknown>;
  previousHash: string;
  hash: string;
}
