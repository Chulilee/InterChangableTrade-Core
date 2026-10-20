import { Module } from '@nestjs/common';
import { AuthorizationAuditService } from './services/authorization-audit.service';
import { AuthorizationService } from './services/authorization.service';
import { DelegationManagerService } from './services/delegation-manager.service';
import { PolicyEngineService } from './services/policy-engine.service';
import { RoleHierarchyService } from './services/role-hierarchy.service';
import { StellarSignerService } from './services/stellar-signer.service';
import { ThresholdManagerService } from './services/threshold-manager.service';

/**
 * Advanced authorization framework: hierarchical roles, a declarative policy
 * engine, delegations with approval chains, dynamic thresholds, Stellar
 * on-chain signers and an immutable audit trail.
 */
@Module({
  providers: [
    RoleHierarchyService,
    PolicyEngineService,
    DelegationManagerService,
    ThresholdManagerService,
    StellarSignerService,
    AuthorizationAuditService,
    AuthorizationService,
  ],
  exports: [
    RoleHierarchyService,
    PolicyEngineService,
    DelegationManagerService,
    ThresholdManagerService,
    StellarSignerService,
    AuthorizationAuditService,
    AuthorizationService,
  ],
})
export class AuthorizationModule {}
