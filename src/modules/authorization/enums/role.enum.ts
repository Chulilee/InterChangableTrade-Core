/**
 * Roles and permissions for the advanced authorization framework.
 *
 * Roles form a hierarchy: a higher role subsumes the permissions of the roles
 * below it, so an `ADMIN` implicitly holds every permission a `TRADER` holds.
 */

/** Granular permissions that can be granted to a role or a delegation. */
export enum Permission {
  // Trading
  TRADE_CREATE = 'trade:create',
  TRADE_CANCEL = 'trade:cancel',
  TRADE_SETTLE = 'trade:settle',

  // Escrow
  ESCROW_CREATE = 'escrow:create',
  ESCROW_APPROVE = 'escrow:approve',
  ESCROW_RELEASE = 'escrow:release',

  // Wallet
  WALLET_READ = 'wallet:read',
  WALLET_SIGN = 'wallet:sign',
  WALLET_KEY_ROTATE = 'wallet:key-rotate',

  // Assets & liquidity
  ASSET_READ = 'asset:read',
  LIQUIDITY_MANAGE = 'liquidity:manage',

  // Compliance & audit
  COMPLIANCE_READ = 'compliance:read',
  COMPLIANCE_WRITE = 'compliance:write',
  AUDIT_READ = 'audit:read',

  // Administration
  USER_MANAGE = 'user:manage',
  POLICY_MANAGE = 'policy:manage',
  API_KEY_MANAGE = 'api-key:manage',
}

/** The hierarchical roles supported by the platform. */
export enum Role {
  TRADER = 'trader',
  AUDITOR = 'auditor',
  CUSTODIAN = 'custodian',
  LIQUIDITY_PROVIDER = 'liquidity_provider',
  COMPLIANCE_OFFICER = 'compliance_officer',
  ADMIN = 'admin',
}

/**
 * Numeric rank of each role. A role with a higher rank subsumes every
 * permission of a role with a lower rank.
 */
export const ROLE_HIERARCHY: Readonly<Record<Role, number>> = Object.freeze({
  [Role.TRADER]: 10,
  [Role.AUDITOR]: 20,
  [Role.LIQUIDITY_PROVIDER]: 30,
  [Role.CUSTODIAN]: 40,
  [Role.COMPLIANCE_OFFICER]: 50,
  [Role.ADMIN]: 100,
});

/** Permissions granted directly by each role. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> =
  Object.freeze({
    [Role.TRADER]: [
      Permission.TRADE_CREATE,
      Permission.TRADE_CANCEL,
      Permission.ESCROW_CREATE,
      Permission.WALLET_READ,
      Permission.ASSET_READ,
    ],
    [Role.AUDITOR]: [
      Permission.AUDIT_READ,
      Permission.COMPLIANCE_READ,
      Permission.WALLET_READ,
      Permission.ASSET_READ,
    ],
    [Role.LIQUIDITY_PROVIDER]: [
      Permission.LIQUIDITY_MANAGE,
      Permission.TRADE_CREATE,
      Permission.TRADE_CANCEL,
      Permission.WALLET_READ,
      Permission.ASSET_READ,
    ],
    [Role.CUSTODIAN]: [
      Permission.WALLET_READ,
      Permission.WALLET_SIGN,
      Permission.WALLET_KEY_ROTATE,
      Permission.ESCROW_RELEASE,
      Permission.TRADE_SETTLE,
      Permission.ASSET_READ,
    ],
    [Role.COMPLIANCE_OFFICER]: [
      Permission.COMPLIANCE_READ,
      Permission.COMPLIANCE_WRITE,
      Permission.AUDIT_READ,
      Permission.ESCROW_CREATE,
      Permission.ESCROW_APPROVE,
      Permission.WALLET_READ,
    ],
    [Role.ADMIN]: Object.freeze(
      Object.values(Permission),
    ) as readonly Permission[],
  });
