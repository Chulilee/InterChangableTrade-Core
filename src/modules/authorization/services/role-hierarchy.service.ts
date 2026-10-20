import { Injectable } from '@nestjs/common';
import { Permission, ROLE_HIERARCHY, ROLE_PERMISSIONS, Role } from '../enums/role.enum';

/**
 * Resolves the hierarchical role model.
 *
 * A role subsumes the permissions of every role with a lower rank, so an
 * `ADMIN` implicitly holds everything a `TRADER` holds. Delegated
 * permissions are layered on top by the caller.
 */
@Injectable()
export class RoleHierarchyService {
  /** Numeric rank of a role; higher ranks subsume lower ones. */
  rank(role: Role): number {
    return ROLE_HIERARCHY[role] ?? 0;
  }

  /** True when `role` is at least as senior as `minimumRole`. */
  isAtLeast(role: Role, minimumRole: Role): boolean {
    return this.rank(role) >= this.rank(minimumRole);
  }

  /** Every permission granted to the given roles, including inherited ones. */
  permissionsFor(roles: readonly Role[]): Set<Permission> {
    const granted = new Set<Permission>();
    for (const role of roles) {
      for (const permission of ROLE_PERMISSIONS[role] ?? []) {
        granted.add(permission);
      }
    }
    return granted;
  }

  /** True when any of the roles grants the permission. */
  hasPermission(roles: readonly Role[], permission: Permission): boolean {
    return this.permissionsFor(roles).has(permission);
  }

  /** All roles the subject effectively holds, including delegated ones. */
  effectiveRoles(roles: readonly Role[], delegated: readonly Permission[] = []) {
    return {
      roles: [...roles],
      permissions: this.permissionsFor(roles),
      delegatedPermissions: new Set(delegated),
    };
  }

  /** Every role known to the system, highest rank first. */
  allRoles(): Role[] {
    return Object.values(Role).sort((a, b) => this.rank(b) - this.rank(a));
  }
}
