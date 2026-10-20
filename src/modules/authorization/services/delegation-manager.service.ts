import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Permission } from '../enums/role.enum';
import { Delegation } from '../interfaces/authorization.types';

export interface CreateDelegationInput {
  delegatorId: string;
  delegateeId: string;
  permissions: Permission[];
  expiresAt: Date;
  /** Identifiers that must approve before the delegation becomes active. */
  approvalChain?: string[];
}

/**
 * Manages delegated authority.
 *
 * A delegation only becomes active once every member of its approval chain
 * has approved, and it stops being usable at its expiry. Every state change
 * is returned to the caller so it can be written to the audit trail.
 */
@Injectable()
export class DelegationManagerService {
  private readonly logger = new Logger(DelegationManagerService.name);
  private readonly delegations = new Map<string, Delegation>();

  createDelegation(input: CreateDelegationInput): Delegation {
    if (input.delegatorId === input.delegateeId) {
      throw new BadRequestException('A delegation cannot target its delegator');
    }
    if (input.permissions.length === 0) {
      throw new BadRequestException(
        'A delegation must grant at least one permission',
      );
    }
    if (input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('A delegation must expire in the future');
    }

    const approvalChain = [...new Set(input.approvalChain ?? [])].filter(
      (approver) => approver !== input.delegateeId,
    );
    const delegation: Delegation = {
      id: randomUUID(),
      delegatorId: input.delegatorId,
      delegateeId: input.delegateeId,
      permissions: [...new Set(input.permissions)],
      expiresAt: input.expiresAt,
      status: approvalChain.length > 0 ? 'pending' : 'active',
      approvalChain,
      approvals: [],
      createdAt: new Date(),
    };

    this.delegations.set(delegation.id, delegation);
    this.logger.log(
      `Delegation ${delegation.id} created by ${delegation.delegatorId} for ${delegation.delegateeId}`,
    );
    return delegation;
  }

  /** Records an approval. The delegation activates once the chain is complete. */
  approveDelegation(delegationId: string, approverId: string): Delegation {
    const delegation = this.requireDelegation(delegationId);
    if (delegation.status === 'revoked') {
      throw new BadRequestException('Cannot approve a revoked delegation');
    }
    if (delegation.status === 'expired' || this.isExpired(delegation)) {
      delegation.status = 'expired';
      throw new BadRequestException('Cannot approve an expired delegation');
    }
    if (!delegation.approvalChain.includes(approverId)) {
      throw new BadRequestException(
        `${approverId} is not part of the approval chain for ${delegationId}`,
      );
    }
    if (!delegation.approvals.includes(approverId)) {
      delegation.approvals.push(approverId);
    }
    if (
      delegation.approvalChain.every((approver) =>
        delegation.approvals.includes(approver),
      )
    ) {
      delegation.status = 'active';
    }
    return delegation;
  }

  revokeDelegation(delegationId: string, requesterId: string): Delegation {
    const delegation = this.requireDelegation(delegationId);
    if (
      delegation.delegatorId !== requesterId &&
      !delegation.approvalChain.includes(requesterId)
    ) {
      throw new BadRequestException(
        'Only the delegator or an approver can revoke this delegation',
      );
    }
    delegation.status = 'revoked';
    return delegation;
  }

  getDelegation(delegationId: string): Delegation | undefined {
    return this.delegations.get(delegationId);
  }

  listDelegations(): Delegation[] {
    return [...this.delegations.values()];
  }

  /** All permissions currently delegated to the subject. */
  activePermissionsFor(subjectId: string): Permission[] {
    const permissions = new Set<Permission>();
    for (const delegation of this.delegations.values()) {
      if (delegation.delegateeId !== subjectId) continue;
      if (delegation.status !== 'active') continue;
      if (this.isExpired(delegation)) {
        delegation.status = 'expired';
        continue;
      }
      for (const permission of delegation.permissions) {
        permissions.add(permission);
      }
    }
    return [...permissions];
  }

  /** True when the subject holds the permission through an active delegation. */
  hasDelegatedPermission(subjectId: string, permission: Permission): boolean {
    return this.activePermissionsFor(subjectId).includes(permission);
  }

  private isExpired(delegation: Delegation): boolean {
    return delegation.expiresAt.getTime() <= Date.now();
  }

  private requireDelegation(delegationId: string): Delegation {
    const delegation = this.delegations.get(delegationId);
    if (!delegation) {
      throw new BadRequestException(`Delegation ${delegationId} not found`);
    }
    return delegation;
  }
}
