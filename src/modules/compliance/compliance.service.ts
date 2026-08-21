import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomBytes } from 'crypto';
import { PaginatedResultDto } from '@app/common';
import { KycVerification } from './entities/kyc-verification.entity';
import { KycDocument } from './entities/kyc-document.entity';
import { AmlFlag } from './entities/aml-flag.entity';
import { ComplianceAuditLog } from './entities/compliance-audit-log.entity';
import { ComplianceConfig } from './entities/compliance-config.entity';
import { KycLevel } from './enums/kyc-level.enum';
import { KycDocumentType } from './enums/kyc-document-type.enum';
import { KycDocumentStatus } from './enums/kyc-document-status.enum';
import { AmlRiskLevel } from './enums/aml-risk-level.enum';
import { AmlFlagStatus } from './enums/aml-flag-status.enum';
import { ComplianceRegion } from './enums/compliance-region.enum';
import { InitiateKycDto } from './dto/initiate-kyc.dto';
import { QueryKycDto } from './dto/query-kyc.dto';
import { QueryAmlFlagDto } from './dto/query-aml-flag.dto';
import { ReviewAmlFlagDto } from './dto/review-aml-flag.dto';
import { AssessTransactionRiskDto } from './dto/assess-transaction-risk.dto';
import { UpdateKycLevelDto } from './dto/update-kyc-level.dto';
import { UpsertComplianceConfigDto } from './dto/upsert-compliance-config.dto';

/** Allowed MIME types for document upload */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Maximum file size: 10 MB */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Risk scoring weights */
const RISK_WEIGHTS = {
  transactionAmount: 25,
  transactionFrequency: 20,
  accountAge: 15,
  regionRisk: 10,
  documentVerification: 20,
  previousFlags: 10,
};

/** High-risk country codes (simplified) */
const HIGH_RISK_REGIONS = new Set(['KP', 'IR', 'SY']);

/** Medium-risk country codes (simplified) */
const MEDIUM_RISK_REGIONS = new Set([
  'RU', 'CN', 'NG', 'PK', 'BD', 'MM', 'IR',
]);

/** Suspicious activity patterns */
export const SUSPICIOUS_PATTERNS = {
  structuring: {
    description: 'Multiple transactions just below reporting threshold',
    threshold: 0.9, // 90% of reporting threshold
  },
  rapidMovement: {
    description: 'Large amounts received and quickly transferred',
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
  },
  unusualVolume: {
    description: 'Transaction volume significantly above user baseline',
    multiplier: 3,
  },
  highRiskJurisdiction: {
    description: 'Transaction involves high-risk jurisdiction',
  },
  roundAmounts: {
    description: 'Multiple round-amount transactions',
    minCount: 5,
  },
};

export interface AuditRecord {
  performedBy: string;
  performedByRole: string;
  targetUserId: string;
  action: string;
  description: string;
  entityType?: string;
  entityId?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    @InjectRepository(KycVerification)
    private readonly kycRepo: Repository<KycVerification>,
    @InjectRepository(KycDocument)
    private readonly documentRepo: Repository<KycDocument>,
    @InjectRepository(AmlFlag)
    private readonly flagRepo: Repository<AmlFlag>,
    @InjectRepository(ComplianceAuditLog)
    private readonly auditRepo: Repository<ComplianceAuditLog>,
    @InjectRepository(ComplianceConfig)
    private readonly configRepo: Repository<ComplianceConfig>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── KYC Verification ────────────────────────────────────────────────────

  /**
   * Initiate KYC verification for a user.
   * Creates or retrieves the verification record and starts the workflow.
   */
  async initiateVerification(
    userId: string,
    dto: InitiateKycDto,
    performedBy?: string,
    performedByRole?: string,
  ): Promise<KycVerification> {
    let verification = await this.kycRepo.findOne({ where: { userId } });

    const previousState: Record<string, unknown> | undefined = verification
      ? { level: verification.level, riskLevel: verification.riskLevel }
      : undefined;

    if (!verification) {
      verification = this.kycRepo.create({
        userId,
        level: KycLevel.UNVERIFIED,
        riskLevel: AmlRiskLevel.LOW,
        riskScore: 0,
        region: dto.region,
      });
    } else {
      // Already at max level
      if (verification.level === KycLevel.INSTITUTIONAL) {
        throw new ConflictException(
          'User is already at maximum KYC verification level',
        );
      }
      verification.region = dto.region;
    }

    const saved = await this.kycRepo.save(verification);

    await this.appendAudit({
      performedBy: performedBy ?? userId,
      performedByRole: performedByRole ?? 'user',
      targetUserId: userId,
      action: 'kyc.initiate_verification',
      description: `KYC verification initiated for region ${dto.region}${dto.targetLevel ? `, targeting ${dto.targetLevel}` : ''}`,
      entityType: 'kyc_verification',
      entityId: saved.id,
      previousState,
      newState: { level: saved.level, riskLevel: saved.riskLevel },
    });

    this.eventEmitter.emit('compliance.kyc.initiated', {
      userId,
      verificationId: saved.id,
      region: dto.region,
    });

    this.logger.log(`KYC verification initiated for user ${userId}`);
    return saved;
  }

  /**
   * Get the KYC status for a user.
   */
  async getVerificationStatus(userId: string): Promise<KycVerification> {
    const verification = await this.kycRepo.findOne({ where: { userId } });
    if (!verification) {
      throw new NotFoundException(
        `No KYC verification found for user ${userId}`,
      );
    }
    return verification;
  }

  /**
   * List KYC verifications with filtering and pagination.
   */
  async listVerifications(
    query: QueryKycDto,
  ): Promise<PaginatedResultDto<KycVerification>> {
    const qb = this.kycRepo
      .createQueryBuilder('kyc')
      .orderBy('kyc.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.level) {
      qb.andWhere('kyc.level = :level', { level: query.level });
    }
    if (query.userId) {
      qb.andWhere('kyc.userId = :userId', { userId: query.userId });
    }
    if (query.region) {
      qb.andWhere('kyc.region = :region', { region: query.region });
    }
    if (query.transactionsBlocked !== undefined) {
      qb.andWhere('kyc.transactionsBlocked = :blocked', {
        blocked: query.transactionsBlocked,
      });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  /**
   * Update a user's KYC level (admin action).
   */
  async updateKycLevel(
    userId: string,
    level: KycLevel,
    dto: UpdateKycLevelDto,
    performedBy: string,
    performedByRole: string,
  ): Promise<KycVerification> {
    const verification = await this.kycRepo.findOne({ where: { userId } });
    if (!verification) {
      throw new NotFoundException(
        `No KYC verification found for user ${userId}`,
      );
    }

    const previousState = {
      level: verification.level,
      riskLevel: verification.riskLevel,
      transactionsBlocked: verification.transactionsBlocked,
    };

    verification.level = level;
    if (dto.transactionsBlocked !== undefined) {
      verification.transactionsBlocked = dto.transactionsBlocked;
    }
    if (dto.blockReason !== undefined) {
      verification.blockReason = dto.blockReason;
    }
    if (dto.notes) {
      verification.complianceNotes = dto.notes;
    }

    const saved = await this.kycRepo.save(verification);

    await this.appendAudit({
      performedBy,
      performedByRole,
      targetUserId: userId,
      action: 'kyc.update_level',
      description: `KYC level updated to ${level}${dto.transactionsBlocked ? ' (transactions blocked)' : ''}`,
      entityType: 'kyc_verification',
      entityId: saved.id,
      previousState,
      newState: {
        level: saved.level,
        riskLevel: saved.riskLevel,
        transactionsBlocked: saved.transactionsBlocked,
      },
    });

    this.eventEmitter.emit('compliance.kyc.level_updated', {
      userId,
      previousLevel: previousState.level,
      newLevel: level,
    });

    this.logger.log(`KYC level updated for user ${userId}: ${previousState.level} → ${level}`);
    return saved;
  }

  // ─── Document Management ──────────────────────────────────────────────────

  /**
   * Upload a KYC document with validation and simulated encryption.
   * In production, the file would be stored in encrypted object storage.
   */
  async uploadDocument(
    userId: string,
    file: Express.Multer.File,
    documentType: KycDocumentType,
    notes?: string,
    performedBy?: string,
    performedByRole?: string,
  ): Promise<KycDocument> {
    // Validate file type
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type: ${file.mimetype}. Allowed: ${Array.from(ALLOWED_MIME_TYPES).join(', ')}`,
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File size ${file.size} exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes`,
      );
    }

    // Get or create KYC verification
    let verification = await this.kycRepo.findOne({ where: { userId } });
    if (!verification) {
      verification = this.kycRepo.create({
        userId,
        level: KycLevel.UNVERIFIED,
        riskLevel: AmlRiskLevel.LOW,
        riskScore: 0,
      });
      verification = await this.kycRepo.save(verification);
    }

    // Compute file hash for integrity
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // Simulate encryption - in production, use AWS KMS or similar
    const encryptionKeyId = `kms-key-${Date.now()}`;
    const storagePath = this.generateStoragePath(userId, documentType, file.originalname);

    const document = this.documentRepo.create({
      userId,
      kycVerificationId: verification.id,
      documentType,
      status: KycDocumentStatus.PENDING,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storagePath,
      fileHash,
      encryptionKeyId,
      metadata: notes ? { note: notes } : null,
    });

    const saved = await this.documentRepo.save(document);

    await this.appendAudit({
      performedBy: performedBy ?? userId,
      performedByRole: performedByRole ?? 'user',
      targetUserId: userId,
      action: 'kyc.document_upload',
      description: `Document uploaded: ${documentType} (${file.originalname}, ${file.size} bytes)`,
      entityType: 'kyc_document',
      entityId: saved.id,
      metadata: {
        documentType,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileHash,
      },
    });

    this.eventEmitter.emit('compliance.kyc.document_uploaded', {
      userId,
      documentId: saved.id,
      documentType,
    });

    this.logger.log(`Document uploaded for user ${userId}: ${documentType} (${file.originalname})`);
    return saved;
  }

  /**
   * Get all documents for a user.
   */
  async getDocuments(userId: string): Promise<KycDocument[]> {
    return this.documentRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get a single document by ID.
   */
  async getDocument(documentId: string): Promise<KycDocument> {
    const doc = await this.documentRepo.findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }
    return doc;
  }

  /**
   * Review a document (admin action) - verify or reject.
   */
  async reviewDocument(
    documentId: string,
    status: KycDocumentStatus.VERIFIED | KycDocumentStatus.REJECTED,
    reviewerId: string,
    reviewerRole: string,
    rejectionReason?: string,
  ): Promise<KycDocument> {
    const document = await this.getDocument(documentId);
    const previousState = { status: document.status };

    document.status = status;
    document.reviewedBy = reviewerId;
    document.reviewedAt = new Date();
    if (status === KycDocumentStatus.REJECTED && rejectionReason) {
      document.rejectionReason = rejectionReason;
    }

    const saved = await this.documentRepo.save(document);

    // Check if all required documents are now verified
    await this.checkDocumentCompletion(document.userId);

    await this.appendAudit({
      performedBy: reviewerId,
      performedByRole: reviewerRole,
      targetUserId: document.userId,
      action: `kyc.document_${status}`,
      description: `Document ${status}: ${document.fileName} (${document.documentType})`,
      entityType: 'kyc_document',
      entityId: documentId,
      previousState,
      newState: { status },
    });

    this.logger.log(`Document ${documentId} reviewed as ${status} by ${reviewerId}`);
    return saved;
  }

  /**
   * Retrieve a document for download (returns storage path and decrypts).
   * In production, this would stream from encrypted storage.
   */
  async retrieveDocument(
    documentId: string,
    userId: string,
  ): Promise<{ storagePath: string; encryptionKeyId: string; fileName: string }> {
    const doc = await this.getDocument(documentId);
    if (doc.userId !== userId) {
      throw new NotFoundException(`Document ${documentId} not found for user`);
    }
    return {
      storagePath: doc.storagePath,
      encryptionKeyId: doc.encryptionKeyId ?? '',
      fileName: doc.fileName,
    };
  }

  // ─── Risk Scoring ─────────────────────────────────────────────────────────

  /**
   * Calculate a user's overall risk score based on multiple factors.
   * Returns a score from 0-100 and the computed risk level.
   */
  async calculateRiskScore(userId: string): Promise<{
    score: number;
    level: AmlRiskLevel;
    factors: Record<string, number>;
  }> {
    const verification = await this.kycRepo.findOne({ where: { userId } });
    const flags = await this.flagRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const documents = await this.documentRepo.find({ where: { userId } });

    const factors: Record<string, number> = {};

    // Factor 1: KYC level contributes inversely (higher level = lower risk)
    const kycLevelScores: Record<string, number> = {
      [KycLevel.UNVERIFIED]: 100,
      [KycLevel.STANDARD]: 40,
      [KycLevel.ENHANCED]: 15,
      [KycLevel.INSTITUTIONAL]: 5,
    };
    factors.kycLevel =
      kycLevelScores[verification?.level ?? KycLevel.UNVERIFIED] *
      (RISK_WEIGHTS.documentVerification / 100);

    // Factor 2: Document verification status
    const verifiedDocs = documents.filter(
      (d) => d.status === KycDocumentStatus.VERIFIED,
    );
    const requiredDocs = [
      KycDocumentType.ID_VERIFICATION,
      KycDocumentType.ADDRESS_PROOF,
    ];
    const verifiedRequiredTypes = new Set(
      verifiedDocs.map((d) => d.documentType),
    );
    const missingRequired = requiredDocs.filter(
      (t) => !verifiedRequiredTypes.has(t),
    );
    factors.documentVerification =
      (missingRequired.length / requiredDocs.length) *
      100 *
      (RISK_WEIGHTS.documentVerification / 100);

    // Factor 3: Previous AML flags
    const recentFlags = flags.filter(
      (f) =>
        f.createdAt &&
        Date.now() - f.createdAt.getTime() < 90 * 24 * 60 * 60 * 1000, // last 90 days
    );
    const criticalFlags = recentFlags.filter(
      (f) => f.riskLevel === AmlRiskLevel.CRITICAL,
    );
    const highFlags = recentFlags.filter(
      (f) => f.riskLevel === AmlRiskLevel.HIGH,
    );
    const flagScore =
      Math.min(criticalFlags.length * 40 + highFlags.length * 20 + recentFlags.length * 5, 100);
    factors.previousFlags =
      flagScore * (RISK_WEIGHTS.previousFlags / 100);

    // Factor 4: Account age (newer accounts are riskier)
    const accountAgeDays = verification?.createdAt
      ? (Date.now() - verification.createdAt.getTime()) / (24 * 60 * 60 * 1000)
      : 0;
    const ageScore = accountAgeDays < 30 ? 90 : accountAgeDays < 90 ? 60 : accountAgeDays < 365 ? 30 : 10;
    factors.accountAge = ageScore * (RISK_WEIGHTS.accountAge / 100);

    // Factor 5: Region risk
    const region = verification?.region?.toUpperCase();
    let regionScore = 20; // default low risk
    if (region && HIGH_RISK_REGIONS.has(region)) {
      regionScore = 100;
    } else if (region && MEDIUM_RISK_REGIONS.has(region)) {
      regionScore = 60;
    }
    factors.regionRisk = regionScore * (RISK_WEIGHTS.regionRisk / 100);

    // Factor 6: Transaction-related factors (defaults since we don't have transaction data here)
    factors.transactionAmount = 0;
    factors.transactionFrequency = 0;

    // Calculate weighted total
    const totalScore = Math.min(
      Math.round(
        Object.values(factors).reduce((sum, val) => sum + val, 0) /
          (Object.keys(RISK_WEIGHTS).length / 100) *
          (100 / Object.keys(factors).length),
      ),
      100,
    );

    // Determine risk level
    const level = this.scoreToRiskLevel(totalScore);

    return { score: totalScore, level, factors };
  }

  /**
   * Update user's risk score and level in the database.
   */
  async updateRiskAssessment(userId: string): Promise<KycVerification> {
    const verification = await this.kycRepo.findOne({ where: { userId } });
    if (!verification) {
      throw new NotFoundException(
        `No KYC verification found for user ${userId}`,
      );
    }

    const assessment = await this.calculateRiskScore(userId);
    const previousState = {
      riskScore: verification.riskScore,
      riskLevel: verification.riskLevel,
    };

    verification.riskScore = assessment.score;
    verification.riskLevel = assessment.level;

    const saved = await this.kycRepo.save(verification);

    await this.appendAudit({
      performedBy: 'system',
      performedByRole: 'system',
      targetUserId: userId,
      action: 'compliance.risk_assessment',
      description: `Risk score updated: ${assessment.score} (${assessment.level})`,
      entityType: 'kyc_verification',
      entityId: saved.id,
      previousState,
      newState: { riskScore: assessment.score, riskLevel: assessment.level },
      metadata: { factors: assessment.factors },
    });

    return saved;
  }

  // ─── Transaction Risk Assessment ──────────────────────────────────────────

  /**
   * Assess risk for a specific transaction and optionally flag it.
   * This is the entry point for transaction monitoring.
   */
  async assessTransactionRisk(
    userId: string,
    dto: AssessTransactionRiskDto,
    performedBy?: string,
    performedByRole?: string,
  ): Promise<{
    riskLevel: AmlRiskLevel;
    riskScore: number;
    shouldBlock: boolean;
    triggeredRules: string[];
    flag?: AmlFlag;
  }> {
    const verification = await this.kycRepo.findOne({ where: { userId } });
    const config = await this.getConfigForRegion(verification?.region ?? 'global');

    const triggeredRules: string[] = [];
    let riskScore = 0;

    // Rule 1: Transaction amount threshold
    if (dto.amount >= parseFloat(config.amlTransactionThreshold)) {
      triggeredRules.push('aml_transaction_threshold');
      riskScore += RISK_WEIGHTS.transactionAmount;
    }

    // Rule 2: Structuring detection (multiple transactions just below threshold)
    if (dto.recentTransactions && dto.recentTransactions.length > 0) {
      const threshold = parseFloat(config.amlTransactionThreshold);
      const structuredTxns = dto.recentTransactions.filter(
        (t) =>
          t.amount >= threshold * SUSPICIOUS_PATTERNS.structuring.threshold &&
          t.amount < threshold,
      );
      if (structuredTxns.length >= 3) {
        triggeredRules.push('structuring_detected');
        riskScore += 30;
      }

      // Rule 3: Rapid movement detection
      const recentWindow = dto.recentTransactions.filter((t) => {
        const txnTime = new Date(t.timestamp).getTime();
        return (
          Date.now() - txnTime < SUSPICIOUS_PATTERNS.rapidMovement.windowMs
        );
      });
      const totalInWindow = recentWindow.reduce(
        (sum, t) => sum + t.amount,
        0,
      );
      if (totalInWindow > parseFloat(config.dailyVolumeThreshold)) {
        triggeredRules.push('rapid_movement');
        riskScore += 25;
      }

      // Rule 4: Unusual volume
      if (dto.recentTransactions.length > config.maxDailyTransactions) {
        triggeredRules.push('unusual_volume');
        riskScore += 20;
      }

      // Rule 5: Round amounts
      const roundAmounts = dto.recentTransactions.filter(
        (t) => t.amount % 1000 === 0 && t.amount > 0,
      );
      if (roundAmounts.length >= SUSPICIOUS_PATTERNS.roundAmounts.minCount) {
        triggeredRules.push('round_amounts');
        riskScore += 15;
      }
    }

    // Rule 6: High-risk region
    if (
      verification?.region &&
      HIGH_RISK_REGIONS.has(verification.region.toUpperCase())
    ) {
      triggeredRules.push('high_risk_jurisdiction');
      riskScore += 20;
    }

    // Rule 7: User's baseline risk score
    riskScore += Math.round(verification?.riskScore ?? 0) * 0.3;

    riskScore = Math.min(Math.round(riskScore), 100);

    const riskLevel = this.scoreToRiskLevel(riskScore);
    const shouldBlock =
      riskScore >= config.blockThresholdScore ||
      riskLevel === AmlRiskLevel.CRITICAL;

    // Create AML flag if rules were triggered
    let flag: AmlFlag | undefined;
    if (triggeredRules.length > 0) {
      flag = this.flagRepo.create({
        userId,
        riskLevel,
        riskScore,
        triggerRule: triggeredRules[0],
        description: `Transaction risk assessment flagged: ${triggeredRules.join(', ')}`,
        transactionAmount: dto.amount.toString(),
        evidence: {
          transactionType: dto.transactionType,
          assetCode: dto.assetCode,
          allTriggeredRules: triggeredRules,
        },
      });
      flag = await this.flagRepo.save(flag);

      await this.appendAudit({
        performedBy: performedBy ?? 'system',
        performedByRole: performedByRole ?? 'system',
        targetUserId: userId,
        action: 'aml.flag_created',
        description: `AML flag created: ${riskLevel} risk (score: ${riskScore}), rules: ${triggeredRules.join(', ')}`,
        entityType: 'aml_flag',
        entityId: flag.id,
        metadata: {
          riskScore,
          riskLevel,
          triggeredRules,
          transactionAmount: dto.amount,
        },
      });

      this.eventEmitter.emit('compliance.aml.flag_created', {
        userId,
        flagId: flag.id,
        riskLevel,
        riskScore,
        triggeredRules,
      });

      this.logger.warn(
        `AML flag created for user ${userId}: ${riskLevel} risk (${riskScore}), rules: ${triggeredRules.join(', ')}`,
      );
    }

    return { riskLevel, riskScore, shouldBlock, triggeredRules, flag };
  }

  // ─── AML Flag Management ──────────────────────────────────────────────────

  /**
   * List AML flags with filtering and pagination.
   */
  async listFlags(
    query: QueryAmlFlagDto,
  ): Promise<PaginatedResultDto<AmlFlag>> {
    const qb = this.flagRepo
      .createQueryBuilder('flag')
      .orderBy('flag.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.status) {
      qb.andWhere('flag.status = :status', { status: query.status });
    }
    if (query.riskLevel) {
      qb.andWhere('flag.riskLevel = :riskLevel', {
        riskLevel: query.riskLevel,
      });
    }
    if (query.userId) {
      qb.andWhere('flag.userId = :userId', { userId: query.userId });
    }
    if (query.triggerRule) {
      qb.andWhere('flag.triggerRule = :triggerRule', {
        triggerRule: query.triggerRule,
      });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  /**
   * Get a single AML flag by ID.
   */
  async getFlag(flagId: string): Promise<AmlFlag> {
    const flag = await this.flagRepo.findOne({ where: { id: flagId } });
    if (!flag) {
      throw new NotFoundException(`AML flag ${flagId} not found`);
    }
    return flag;
  }

  /**
   * Admin review of a flagged transaction/activity.
   */
  async reviewFlag(
    flagId: string,
    reviewerId: string,
    reviewerRole: string,
    dto: ReviewAmlFlagDto,
    ipAddress?: string,
  ): Promise<AmlFlag> {
    const flag = await this.getFlag(flagId);

    if (flag.status !== AmlFlagStatus.PENDING && flag.status !== AmlFlagStatus.REVIEWING) {
      throw new ConflictException(
        `AML flag ${flagId} is already in ${flag.status} status and cannot be reviewed`,
      );
    }

    const previousState = {
      status: flag.status,
      resolutionNotes: flag.resolutionNotes,
      sarFiled: flag.sarFiled,
    };

    flag.status = dto.status;
    flag.resolutionNotes = dto.resolutionNotes;
    flag.reviewedBy = reviewerId;
    flag.reviewedAt = new Date();
    if (dto.sarFiled !== undefined) {
      flag.sarFiled = dto.sarFiled;
    }
    if (dto.sarReference) {
      flag.sarReference = dto.sarReference;
    }
    if (dto.evidence) {
      try {
        flag.evidence = JSON.parse(dto.evidence);
      } catch {
        flag.evidence = { rawEvidence: dto.evidence };
      }
    }

    const saved = await this.flagRepo.save(flag);

    await this.appendAudit({
      performedBy: reviewerId,
      performedByRole: reviewerRole,
      targetUserId: flag.userId,
      action: `aml.flag_${dto.status}`,
      description: `AML flag reviewed: ${dto.status} - ${dto.resolutionNotes}`,
      entityType: 'aml_flag',
      entityId: flagId,
      previousState,
      newState: {
        status: dto.status,
        resolutionNotes: dto.resolutionNotes,
        sarFiled: dto.sarFiled,
      },
      ipAddress,
    });

    this.eventEmitter.emit('compliance.aml.flag_reviewed', {
      flagId,
      userId: flag.userId,
      status: dto.status,
      reviewerId,
    });

    this.logger.log(
      `AML flag ${flagId} reviewed as ${dto.status} by ${reviewerId}`,
    );
    return saved;
  }

  // ─── Compliance Configuration ─────────────────────────────────────────────

  /**
   * Get or create compliance config for a region.
   */
  async getConfigForRegion(region: string): Promise<ComplianceConfig> {
    const normalizedRegion = region.toLowerCase() as ComplianceRegion;
    const existingConfig = await this.configRepo.findOne({
      where: { region: normalizedRegion },
    });

    if (existingConfig) {
      return existingConfig;
    }

    // Fall back to global config
    const globalConfig = await this.configRepo.findOne({
      where: { region: ComplianceRegion.GLOBAL },
    });

    if (globalConfig) {
      return globalConfig;
    }

    // Create default global config
    const defaultConfig = this.configRepo.create({
      region: ComplianceRegion.GLOBAL,
      displayName: 'Global (Default)',
      amlTransactionThreshold: '10000',
      dailyVolumeThreshold: '50000',
      blockThresholdScore: 80,
      enhancedDueDiligenceScore: 60,
      flagThresholdScore: 40,
      maxDailyTransactions: 50,
      kycExpiryMonths: 12,
      requireSarForCritical: true,
    });
    const savedConfig = new ComplianceConfig();
    Object.assign(savedConfig, await this.configRepo.save(defaultConfig));
    return savedConfig;
  }

  /**
   * List all compliance configurations.
   */
  async listConfigs(): Promise<ComplianceConfig[]> {
    return this.configRepo.find({ order: { region: 'ASC' } });
  }

  /**
   * Create or update compliance configuration for a region.
   */
  async upsertConfig(
    dto: Partial<UpsertComplianceConfigDto>,
    performedBy: string,
    performedByRole: string,
  ): Promise<ComplianceConfig> {
    const region = dto.region as ComplianceRegion;
    const existing = await this.configRepo.findOne({ where: { region } });

    const previousState: Record<string, unknown> | undefined = existing
      ? { ...existing }
      : undefined;

    let savedEntity: ComplianceConfig;
    if (existing) {
      Object.assign(existing, dto);
      savedEntity = await this.configRepo.save(existing) as unknown as ComplianceConfig;
    } else {
      const newConfig = this.configRepo.create(dto as any);
      savedEntity = await this.configRepo.save(newConfig) as unknown as ComplianceConfig;
    }

    await this.appendAudit({
      performedBy,
      performedByRole,
      targetUserId: 'system',
      action: previousState ? 'compliance.config_update' : 'compliance.config_create',
      description: `Compliance config ${previousState ? 'updated' : 'created'} for region ${region}`,
      entityType: 'compliance_config',
      entityId: savedEntity.id,
      previousState,
      newState: savedEntity as unknown as Record<string, unknown>,
    });

    return savedEntity;
  }

  // ─── Audit Trail ──────────────────────────────────────────────────────────

  /**
   * Append a compliance audit record.
   */
  async appendAudit(record: AuditRecord): Promise<ComplianceAuditLog> {
    const entity = this.auditRepo.create({
      performedBy: record.performedBy,
      performedByRole: record.performedByRole,
      targetUserId: record.targetUserId,
      action: record.action,
      description: record.description,
      entityType: record.entityType ?? null,
      entityId: record.entityId ?? null,
      previousState: record.previousState ?? null,
      newState: record.newState ?? null,
      ipAddress: record.ipAddress ?? null,
      metadata: record.metadata ?? null,
    });
    return this.auditRepo.save(entity);
  }

  /**
   * Get audit trail for a user.
   */
  async getAuditTrail(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResultDto<ComplianceAuditLog>> {
    const qb = this.auditRepo
      .createQueryBuilder('log')
      .where('log.targetUserId = :userId', { userId })
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, page, limit);
  }

  /**
   * Get all audit logs (admin).
   */
  async getAllAuditLogs(
    page = 1,
    limit = 20,
  ): Promise<PaginatedResultDto<ComplianceAuditLog>> {
    const qb = this.auditRepo
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, page, limit);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Convert a numeric risk score (0-100) to a risk level.
   */
  scoreToRiskLevel(score: number): AmlRiskLevel {
    if (score >= 75) return AmlRiskLevel.CRITICAL;
    if (score >= 50) return AmlRiskLevel.HIGH;
    if (score >= 25) return AmlRiskLevel.MEDIUM;
    return AmlRiskLevel.LOW;
  }

  /**
   * Check if a user's documents are complete and update KYC level accordingly.
   */
  private async checkDocumentCompletion(userId: string): Promise<void> {
    const documents = await this.documentRepo.find({ where: { userId } });
    const verification = await this.kycRepo.findOne({ where: { userId } });
    if (!verification) return;

    const requiredTypes = [
      KycDocumentType.ID_VERIFICATION,
      KycDocumentType.ADDRESS_PROOF,
    ];
    const verifiedTypes = new Set(
      documents
        .filter((d) => d.status === KycDocumentStatus.VERIFIED)
        .map((d) => d.documentType),
    );

    const allRequiredVerified = requiredTypes.every((t) =>
      verifiedTypes.has(t),
    );

    const hasBeneficialOwnership = verifiedTypes.has(
      KycDocumentType.BENEFICIAL_OWNERSHIP,
    );

    let newLevel = verification.level;
    if (allRequiredVerified && hasBeneficialOwnership) {
      newLevel = KycLevel.ENHANCED;
    } else if (allRequiredVerified) {
      newLevel = KycLevel.STANDARD;
    }

    if (newLevel !== verification.level) {
      verification.level = newLevel;
      await this.kycRepo.save(verification);

      this.eventEmitter.emit('compliance.kyc.level_updated', {
        userId,
        previousLevel: verification.level,
        newLevel,
        reason: 'document_verification_complete',
      });
    }
  }

  /**
   * Generate an encrypted storage path for document storage.
   */
  private generateStoragePath(
    userId: string,
    documentType: KycDocumentType,
    originalFilename: string,
  ): string {
    const salt = randomBytes(16).toString('hex');
    const hash = createHash('sha256')
      .update(`${userId}-${documentType}-${salt}-${Date.now()}`)
      .digest('hex');
    const ext = originalFilename.split('.').pop() ?? 'bin';
    return `compliance/${userId}/${documentType}/${hash}.${ext}`;
  }

  /**
   * Check if a user's transactions should be blocked.
   */
  async shouldBlockTransactions(userId: string): Promise<boolean> {
    const verification = await this.kycRepo.findOne({ where: { userId } });
    if (!verification) return true; // Unknown users are blocked
    if (verification.transactionsBlocked) return true;
    if (verification.riskLevel === AmlRiskLevel.CRITICAL) return true;

    const config = await this.getConfigForRegion(
      verification.region ?? 'global',
    );
    return verification.riskScore >= config.blockThresholdScore;
  }
}
