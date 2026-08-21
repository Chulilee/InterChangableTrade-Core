import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycVerification } from './entities/kyc-verification.entity';
import { KycDocument } from './entities/kyc-document.entity';
import { AmlFlag } from './entities/aml-flag.entity';
import { ComplianceAuditLog } from './entities/compliance-audit-log.entity';
import { ComplianceConfig } from './entities/compliance-config.entity';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';

/**
 * KYC/AML Compliance Module.
 *
 * Manages user identity verification, document collection,
 * risk assessment, and regulatory compliance workflows.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KycVerification,
      KycDocument,
      AmlFlag,
      ComplianceAuditLog,
      ComplianceConfig,
    ]),
  ],
  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
