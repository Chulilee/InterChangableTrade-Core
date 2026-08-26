import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import {
  ComplianceService,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  SUSPICIOUS_PATTERNS,
} from './compliance.service';
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

type RepoMock<T = any> = {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  count: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function createQueryBuilderMock(data: any[] = [], total?: number) {
  return {
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([data, total ?? data.length]),
  };
}

describe('ComplianceService', () => {
  let service: ComplianceService;
  let kycRepo: RepoMock;
  let documentRepo: RepoMock;
  let flagRepo: RepoMock;
  let auditRepo: RepoMock;
  let configRepo: RepoMock;
  let eventEmitter: jest.Mocked<Partial<EventEmitter2>>;

  const userId = 'user-1';
  const adminId = 'admin-1';
  const userRole = 'user';
  const adminRole = 'admin';

  const mockVerification: Partial<KycVerification> = {
    id: 'kyc-1',
    userId,
    level: KycLevel.UNVERIFIED,
    riskLevel: AmlRiskLevel.LOW,
    riskScore: 10,
    region: 'US',
    transactionsBlocked: false,
    createdAt: new Date('2025-01-01'),
  };

  const mockConfig: Partial<ComplianceConfig> = {
    id: 'config-1',
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
    isActive: true,
  };

  beforeEach(() => {
    kycRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((v) => ({ id: 'kyc-1', ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock()),
    };

    documentRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v) => ({ id: 'doc-1', ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock()),
    };

    flagRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v) => ({ id: 'flag-1', ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock()),
    };

    auditRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((v) => ({ id: 'audit-1', ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock()),
    };

    configRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((v) => ({ id: 'config-1', ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock()),
    };

    eventEmitter = { emit: jest.fn() };

    service = new ComplianceService(
      kycRepo as any,
      documentRepo as any,
      flagRepo as any,
      auditRepo as any,
      configRepo as any,
      eventEmitter as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ─── scoreToRiskLevel ──────────────────────────────────────────────────

  describe('scoreToRiskLevel', () => {
    it('returns LOW for scores 0-24', () => {
      expect(service.scoreToRiskLevel(0)).toBe(AmlRiskLevel.LOW);
      expect(service.scoreToRiskLevel(24)).toBe(AmlRiskLevel.LOW);
    });

    it('returns MEDIUM for scores 25-49', () => {
      expect(service.scoreToRiskLevel(25)).toBe(AmlRiskLevel.MEDIUM);
      expect(service.scoreToRiskLevel(49)).toBe(AmlRiskLevel.MEDIUM);
    });

    it('returns HIGH for scores 50-74', () => {
      expect(service.scoreToRiskLevel(50)).toBe(AmlRiskLevel.HIGH);
      expect(service.scoreToRiskLevel(74)).toBe(AmlRiskLevel.HIGH);
    });

    it('returns CRITICAL for scores 75-100', () => {
      expect(service.scoreToRiskLevel(75)).toBe(AmlRiskLevel.CRITICAL);
      expect(service.scoreToRiskLevel(100)).toBe(AmlRiskLevel.CRITICAL);
    });
  });

  // ─── KYC Verification ──────────────────────────────────────────────────

  describe('initiateVerification', () => {
    it('creates a new KYC verification record', async () => {
      kycRepo.findOne.mockResolvedValue(null);

      const result = await service.initiateVerification(userId, {
        region: 'US',
      });

      expect(kycRepo.create).toHaveBeenCalled();
      expect(kycRepo.save).toHaveBeenCalled();
      expect(auditRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'compliance.kyc.initiated',
        expect.objectContaining({ userId }),
      );
    });

    it('updates an existing verification record', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        level: KycLevel.STANDARD,
      });

      const result = await service.initiateVerification(userId, {
        region: 'EU',
      });

      expect(result.region).toBe('EU');
      expect(kycRepo.save).toHaveBeenCalled();
    });

    it('rejects if already at institutional level', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        level: KycLevel.INSTITUTIONAL,
      });

      await expect(
        service.initiateVerification(userId, { region: 'US' }),
      ).rejects.toThrow(ConflictException);
    });

    it('records audit trail with correct action', async () => {
      kycRepo.findOne.mockResolvedValue(null);
      kycRepo.save.mockResolvedValue({ ...mockVerification, id: 'kyc-new' });

      await service.initiateVerification(userId, {
        region: 'US',
        targetLevel: KycLevel.ENHANCED,
      });

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'kyc.initiate_verification',
          targetUserId: userId,
        }),
      );
    });
  });

  describe('getVerificationStatus', () => {
    it('returns verification for existing user', async () => {
      kycRepo.findOne.mockResolvedValue(mockVerification);
      const result = await service.getVerificationStatus(userId);
      expect(result.userId).toBe(userId);
    });

    it('throws NotFoundException for non-existent user', async () => {
      kycRepo.findOne.mockResolvedValue(null);
      await expect(service.getVerificationStatus('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listVerifications', () => {
    it('lists with pagination', async () => {
      const qb = createQueryBuilderMock([mockVerification], 1);
      kycRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listVerifications({
        page: 1,
        limit: 20,
        skip: 0,
      } as any);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('applies level filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      kycRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listVerifications({
        page: 1,
        limit: 20,
        skip: 0,
        level: KycLevel.STANDARD,
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('kyc.level = :level', {
        level: KycLevel.STANDARD,
      });
    });

    it('applies userId filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      kycRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listVerifications({
        page: 1,
        limit: 20,
        skip: 0,
        userId,
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('kyc.userId = :userId', {
        userId,
      });
    });

    it('applies region filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      kycRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listVerifications({
        page: 1,
        limit: 20,
        skip: 0,
        region: 'US',
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('kyc.region = :region', {
        region: 'US',
      });
    });

    it('applies transactionsBlocked filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      kycRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listVerifications({
        page: 1,
        limit: 20,
        skip: 0,
        transactionsBlocked: true,
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'kyc.transactionsBlocked = :blocked',
        { blocked: true },
      );
    });
  });

  describe('updateKycLevel', () => {
    it('updates KYC level with audit', async () => {
      kycRepo.findOne.mockResolvedValue({ ...mockVerification });
      kycRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.updateKycLevel(
        userId,
        KycLevel.ENHANCED,
        { notes: 'Verified via video call' },
        adminId,
        adminRole,
      );

      expect(result.level).toBe(KycLevel.ENHANCED);
      expect(auditRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'compliance.kyc.level_updated',
        expect.anything(),
      );
    });

    it('blocks transactions when requested', async () => {
      kycRepo.findOne.mockResolvedValue({ ...mockVerification });
      kycRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.updateKycLevel(
        userId,
        KycLevel.UNVERIFIED,
        { transactionsBlocked: true, blockReason: 'Suspicious activity' },
        adminId,
        adminRole,
      );

      expect(result.transactionsBlocked).toBe(true);
      expect(result.blockReason).toBe('Suspicious activity');
    });

    it('throws NotFoundException for missing verification', async () => {
      kycRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateKycLevel(
          userId,
          KycLevel.STANDARD,
          {},
          adminId,
          adminRole,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Document Management ────────────────────────────────────────────────

  describe('uploadDocument', () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'passport.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('test file content'),
      destination: '',
      filename: 'passport.pdf',
      path: '',
      stream: null as any,
    } as any;

    it('uploads a valid document', async () => {
      kycRepo.findOne.mockResolvedValue(mockVerification);

      const result = await service.uploadDocument(
        userId,
        mockFile,
        KycDocumentType.ID_VERIFICATION,
      );

      expect(documentRepo.create).toHaveBeenCalled();
      expect(documentRepo.save).toHaveBeenCalled();
      expect(auditRepo.save).toHaveBeenCalled();
    });

    it('creates KYC verification if none exists', async () => {
      kycRepo.findOne.mockResolvedValue(null);
      kycRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.uploadDocument(
        userId,
        mockFile,
        KycDocumentType.ID_VERIFICATION,
      );

      expect(kycRepo.create).toHaveBeenCalled();
    });

    it('rejects invalid file types', async () => {
      kycRepo.findOne.mockResolvedValue(mockVerification);
      const invalidFile = { ...mockFile, mimetype: 'application/x-executable' };

      await expect(
        service.uploadDocument(
          userId,
          invalidFile,
          KycDocumentType.ID_VERIFICATION,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects files exceeding max size', async () => {
      kycRepo.findOne.mockResolvedValue(mockVerification);
      const largeFile = { ...mockFile, size: MAX_FILE_SIZE_BYTES + 1 };

      await expect(
        service.uploadDocument(
          userId,
          largeFile,
          KycDocumentType.ID_VERIFICATION,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts all allowed MIME types', async () => {
      kycRepo.findOne.mockResolvedValue(mockVerification);
      for (const mime of ALLOWED_MIME_TYPES) {
        const file = { ...mockFile, mimetype: mime };
        const result = await service.uploadDocument(
          userId,
          file,
          KycDocumentType.ADDRESS_PROOF,
        );
        expect(result).toBeDefined();
      }
    });
  });

  describe('getDocuments', () => {
    it('returns documents for a user', async () => {
      documentRepo.find.mockResolvedValue([{ id: 'doc-1' }]);
      const result = await service.getDocuments(userId);
      expect(result).toHaveLength(1);
    });
  });

  describe('getDocument', () => {
    it('returns a document by ID', async () => {
      documentRepo.findOne.mockResolvedValue({ id: 'doc-1', userId });
      const result = await service.getDocument('doc-1');
      expect(result.id).toBe('doc-1');
    });

    it('throws NotFoundException for missing document', async () => {
      documentRepo.findOne.mockResolvedValue(null);
      await expect(service.getDocument('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reviewDocument', () => {
    it('verifies a document', async () => {
      documentRepo.findOne.mockResolvedValue({
        id: 'doc-1',
        userId,
        status: KycDocumentStatus.PENDING,
        documentType: KycDocumentType.ID_VERIFICATION,
        fileName: 'passport.pdf',
      });
      documentRepo.save.mockImplementation((v) => Promise.resolve(v));
      documentRepo.find.mockResolvedValue([
        {
          id: 'doc-1',
          userId,
          status: KycDocumentStatus.VERIFIED,
          documentType: KycDocumentType.ID_VERIFICATION,
        },
      ]);
      kycRepo.findOne.mockResolvedValue({ ...mockVerification });

      const result = await service.reviewDocument(
        'doc-1',
        KycDocumentStatus.VERIFIED,
        adminId,
        adminRole,
      );

      expect(result.status).toBe(KycDocumentStatus.VERIFIED);
      expect(result.reviewedBy).toBe(adminId);
    });

    it('rejects a document with reason', async () => {
      documentRepo.findOne.mockResolvedValue({
        id: 'doc-1',
        userId,
        status: KycDocumentStatus.PENDING,
        documentType: KycDocumentType.ID_VERIFICATION,
        fileName: 'passport.pdf',
      });
      documentRepo.save.mockImplementation((v) => Promise.resolve(v));
      documentRepo.find.mockResolvedValue([]);
      kycRepo.findOne.mockResolvedValue({ ...mockVerification });

      const result = await service.reviewDocument(
        'doc-1',
        KycDocumentStatus.REJECTED,
        adminId,
        adminRole,
        'Image is blurry',
      );

      expect(result.status).toBe(KycDocumentStatus.REJECTED);
      expect(result.rejectionReason).toBe('Image is blurry');
    });
  });

  describe('retrieveDocument', () => {
    it('returns storage reference for valid document', async () => {
      documentRepo.findOne.mockResolvedValue({
        id: 'doc-1',
        userId,
        storagePath: '/storage/path',
        encryptionKeyId: 'key-123',
        fileName: 'passport.pdf',
      });

      const result = await service.retrieveDocument('doc-1', userId);
      expect(result.storagePath).toBe('/storage/path');
      expect(result.encryptionKeyId).toBe('key-123');
    });

    it('throws NotFoundException for wrong user', async () => {
      documentRepo.findOne.mockResolvedValue({
        id: 'doc-1',
        userId: 'other-user',
      });

      await expect(service.retrieveDocument('doc-1', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Risk Scoring ──────────────────────────────────────────────────────

  describe('calculateRiskScore', () => {
    it('returns LOW score for fully verified user', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        level: KycLevel.ENHANCED,
        region: 'US',
        createdAt: new Date('2024-01-01'),
      });
      flagRepo.find.mockResolvedValue([]);
      documentRepo.find.mockResolvedValue([
        {
          status: KycDocumentStatus.VERIFIED,
          documentType: KycDocumentType.ID_VERIFICATION,
        },
        {
          status: KycDocumentStatus.VERIFIED,
          documentType: KycDocumentType.ADDRESS_PROOF,
        },
        {
          status: KycDocumentStatus.VERIFIED,
          documentType: KycDocumentType.BENEFICIAL_OWNERSHIP,
        },
      ]);

      const result = await service.calculateRiskScore(userId);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.level).toBeDefined();
      expect(result.factors).toBeDefined();
    });

    it('returns HIGH score for unverified user in high-risk region', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        level: KycLevel.UNVERIFIED,
        region: 'KP',
        createdAt: new Date(),
      });
      flagRepo.find.mockResolvedValue([]);
      documentRepo.find.mockResolvedValue([]);

      const result = await service.calculateRiskScore(userId);
      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(result.level).toMatch(/high|critical/);
    });

    it('increases score with recent AML flags', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        level: KycLevel.STANDARD,
        createdAt: new Date('2024-01-01'),
      });
      flagRepo.find.mockResolvedValue([
        { riskLevel: AmlRiskLevel.CRITICAL, createdAt: new Date() },
        { riskLevel: AmlRiskLevel.HIGH, createdAt: new Date() },
        { riskLevel: AmlRiskLevel.MEDIUM, createdAt: new Date() },
      ]);
      documentRepo.find.mockResolvedValue([]);

      const result = await service.calculateRiskScore(userId);
      expect(result.factors.previousFlags).toBeGreaterThan(0);
    });

    it('considers account age factor', async () => {
      // New account (created today)
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        level: KycLevel.UNVERIFIED,
        createdAt: new Date(),
      });
      flagRepo.find.mockResolvedValue([]);
      documentRepo.find.mockResolvedValue([]);

      const resultNew = await service.calculateRiskScore(userId);
      expect(resultNew.factors.accountAge).toBeGreaterThan(0);

      // Old account (created 2 years ago)
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        level: KycLevel.UNVERIFIED,
        createdAt: new Date('2023-01-01'),
      });

      const resultOld = await service.calculateRiskScore(userId);
      expect(resultOld.factors.accountAge).toBeLessThan(
        resultNew.factors.accountAge,
      );
    });

    it('accounts for medium-risk regions', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        level: KycLevel.STANDARD,
        region: 'CN',
        createdAt: new Date('2024-01-01'),
      });
      flagRepo.find.mockResolvedValue([]);
      documentRepo.find.mockResolvedValue([]);

      const result = await service.calculateRiskScore(userId);
      expect(result.factors.regionRisk).toBeGreaterThan(0);
    });

    it('returns complete factors object', async () => {
      kycRepo.findOne.mockResolvedValue(mockVerification);
      flagRepo.find.mockResolvedValue([]);
      documentRepo.find.mockResolvedValue([]);

      const result = await service.calculateRiskScore(userId);
      expect(result.factors).toHaveProperty('kycLevel');
      expect(result.factors).toHaveProperty('documentVerification');
      expect(result.factors).toHaveProperty('previousFlags');
      expect(result.factors).toHaveProperty('accountAge');
      expect(result.factors).toHaveProperty('regionRisk');
    });
  });

  describe('updateRiskAssessment', () => {
    it('updates risk score and level', async () => {
      kycRepo.findOne.mockResolvedValue({ ...mockVerification });
      kycRepo.save.mockImplementation((v) => Promise.resolve(v));
      flagRepo.find.mockResolvedValue([]);
      documentRepo.find.mockResolvedValue([]);

      const result = await service.updateRiskAssessment(userId);
      expect(result.riskScore).toBeDefined();
      expect(result.riskLevel).toBeDefined();
      expect(auditRepo.save).toHaveBeenCalled();
    });

    it('throws NotFoundException for missing user', async () => {
      kycRepo.findOne.mockResolvedValue(null);
      await expect(service.updateRiskAssessment('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Transaction Risk Assessment ────────────────────────────────────────

  describe('assessTransactionRisk', () => {
    beforeEach(() => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        riskScore: 10,
      });
      configRepo.findOne.mockResolvedValue(mockConfig);
      flagRepo.create.mockImplementation((v) => v);
      flagRepo.save.mockImplementation((v) =>
        Promise.resolve({ id: 'flag-1', ...v }),
      );
    });

    it('returns LOW risk for small transaction', async () => {
      const result = await service.assessTransactionRisk(userId, {
        amount: 100,
        transactionType: 'buy',
      });

      expect(result.riskLevel).toBeDefined();
      expect(result.shouldBlock).toBe(false);
      expect(result.triggeredRules).toHaveLength(0);
    });

    it('flags large transaction exceeding threshold', async () => {
      const result = await service.assessTransactionRisk(userId, {
        amount: 15000,
        transactionType: 'buy',
      });

      expect(result.triggeredRules).toContain('aml_transaction_threshold');
      expect(result.flag).toBeDefined();
    });

    it('detects structuring pattern', async () => {
      const recentTxns = Array.from({ length: 5 }, (_, i) => ({
        amount: 9500, // Just below 10000 threshold
        timestamp: new Date().toISOString(),
      }));

      const result = await service.assessTransactionRisk(userId, {
        amount: 9500,
        transactionType: 'buy',
        recentTransactions: recentTxns,
      });

      expect(result.triggeredRules).toContain('structuring_detected');
    });

    it('detects rapid movement pattern', async () => {
      const recentTxns = Array.from({ length: 10 }, (_, i) => ({
        amount: 6000,
        timestamp: new Date().toISOString(),
      }));

      const result = await service.assessTransactionRisk(userId, {
        amount: 5000,
        transactionType: 'buy',
        recentTransactions: recentTxns,
      });

      expect(result.triggeredRules).toContain('rapid_movement');
    });

    it('detects unusual volume', async () => {
      const recentTxns = Array.from({ length: 60 }, (_, i) => ({
        amount: 100,
        timestamp: new Date().toISOString(),
      }));

      const result = await service.assessTransactionRisk(userId, {
        amount: 100,
        transactionType: 'buy',
        recentTransactions: recentTxns,
      });

      expect(result.triggeredRules).toContain('unusual_volume');
    });

    it('detects round amount pattern', async () => {
      const recentTxns = Array.from({ length: 6 }, (_, i) => ({
        amount: 5000,
        timestamp: new Date().toISOString(),
      }));

      const result = await service.assessTransactionRisk(userId, {
        amount: 5000,
        transactionType: 'buy',
        recentTransactions: recentTxns,
      });

      expect(result.triggeredRules).toContain('round_amounts');
    });

    it('flags high-risk jurisdiction', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        region: 'KP',
      });

      const result = await service.assessTransactionRisk(userId, {
        amount: 100,
        transactionType: 'buy',
      });

      expect(result.triggeredRules).toContain('high_risk_jurisdiction');
    });

    it('blocks transaction when risk exceeds threshold', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        riskScore: 100,
        region: 'KP',
      });

      // Add recent transactions that trigger unusual_volume
      const recentTxns = Array.from({ length: 60 }, (_, i) => ({
        amount: 100,
        timestamp: new Date().toISOString(),
      }));

      const result = await service.assessTransactionRisk(userId, {
        amount: 15000,
        transactionType: 'buy',
        recentTransactions: recentTxns,
      });

      // 25 (threshold) + 20 (KP) + 20 (volume) + 30 (riskScore*0.3) = 95 >= 80
      expect(result.shouldBlock).toBe(true);
    });

    it('does not create flag for clean transactions', async () => {
      const result = await service.assessTransactionRisk(userId, {
        amount: 100,
        transactionType: 'buy',
      });

      expect(result.flag).toBeUndefined();
    });
  });

  // ─── AML Flag Management ───────────────────────────────────────────────

  describe('listFlags', () => {
    it('lists flags with pagination', async () => {
      const qb = createQueryBuilderMock(
        [{ id: 'flag-1', status: AmlFlagStatus.PENDING }],
        1,
      );
      flagRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listFlags({
        page: 1,
        limit: 20,
        skip: 0,
      } as any);

      expect(result.data).toHaveLength(1);
    });

    it('applies status filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      flagRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listFlags({
        page: 1,
        limit: 20,
        skip: 0,
        status: AmlFlagStatus.PENDING,
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('flag.status = :status', {
        status: AmlFlagStatus.PENDING,
      });
    });

    it('applies riskLevel filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      flagRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listFlags({
        page: 1,
        limit: 20,
        skip: 0,
        riskLevel: AmlRiskLevel.HIGH,
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('flag.riskLevel = :riskLevel', {
        riskLevel: AmlRiskLevel.HIGH,
      });
    });

    it('applies userId filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      flagRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listFlags({
        page: 1,
        limit: 20,
        skip: 0,
        userId,
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('flag.userId = :userId', {
        userId,
      });
    });

    it('applies triggerRule filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      flagRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listFlags({
        page: 1,
        limit: 20,
        skip: 0,
        triggerRule: 'structuring_detected',
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'flag.triggerRule = :triggerRule',
        { triggerRule: 'structuring_detected' },
      );
    });
  });

  describe('getFlag', () => {
    it('returns a flag by ID', async () => {
      flagRepo.findOne.mockResolvedValue({ id: 'flag-1', userId });
      const result = await service.getFlag('flag-1');
      expect(result.id).toBe('flag-1');
    });

    it('throws NotFoundException for missing flag', async () => {
      flagRepo.findOne.mockResolvedValue(null);
      await expect(service.getFlag('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reviewFlag', () => {
    it('reviews and clears a pending flag', async () => {
      flagRepo.findOne.mockResolvedValue({
        id: 'flag-1',
        userId,
        status: AmlFlagStatus.PENDING,
      });
      flagRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.reviewFlag('flag-1', adminId, adminRole, {
        status: AmlFlagStatus.CLEARED,
        resolutionNotes: 'Transaction is legitimate',
      });

      expect(result.status).toBe(AmlFlagStatus.CLEARED);
      expect(result.resolutionNotes).toBe('Transaction is legitimate');
      expect(result.reviewedBy).toBe(adminId);
    });

    it('reviews and confirms a flag with SAR filing', async () => {
      flagRepo.findOne.mockResolvedValue({
        id: 'flag-1',
        userId,
        status: AmlFlagStatus.PENDING,
      });
      flagRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.reviewFlag('flag-1', adminId, adminRole, {
        status: AmlFlagStatus.CONFIRMED,
        resolutionNotes: 'Confirmed suspicious activity',
        sarFiled: true,
        sarReference: 'SAR-2025-001',
      });

      expect(result.status).toBe(AmlFlagStatus.CONFIRMED);
      expect(result.sarFiled).toBe(true);
      expect(result.sarReference).toBe('SAR-2025-001');
    });

    it('parses evidence from JSON string', async () => {
      flagRepo.findOne.mockResolvedValue({
        id: 'flag-1',
        userId,
        status: AmlFlagStatus.PENDING,
      });
      flagRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.reviewFlag('flag-1', adminId, adminRole, {
        status: AmlFlagStatus.CONFIRMED,
        resolutionNotes: 'Confirmed',
        evidence: JSON.stringify({ key: 'value' }),
      });

      expect(result.evidence).toEqual({ key: 'value' });
    });

    it('handles non-JSON evidence as raw string', async () => {
      flagRepo.findOne.mockResolvedValue({
        id: 'flag-1',
        userId,
        status: AmlFlagStatus.PENDING,
      });
      flagRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.reviewFlag('flag-1', adminId, adminRole, {
        status: AmlFlagStatus.CONFIRMED,
        resolutionNotes: 'Confirmed',
        evidence: 'plain text evidence',
      });

      expect(result.evidence).toEqual({ rawEvidence: 'plain text evidence' });
    });

    it('rejects review of already reviewed flag', async () => {
      flagRepo.findOne.mockResolvedValue({
        id: 'flag-1',
        userId,
        status: AmlFlagStatus.CLEARED,
      });

      await expect(
        service.reviewFlag('flag-1', adminId, adminRole, {
          status: AmlFlagStatus.CLEARED,
          resolutionNotes: 'Double review',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows review of reviewing-status flags', async () => {
      flagRepo.findOne.mockResolvedValue({
        id: 'flag-1',
        userId,
        status: AmlFlagStatus.REVIEWING,
      });
      flagRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.reviewFlag('flag-1', adminId, adminRole, {
        status: AmlFlagStatus.CLEARED,
        resolutionNotes: 'Completed review',
      });

      expect(result.status).toBe(AmlFlagStatus.CLEARED);
    });

    it('emits flag_reviewed event', async () => {
      flagRepo.findOne.mockResolvedValue({
        id: 'flag-1',
        userId,
        status: AmlFlagStatus.PENDING,
      });
      flagRepo.save.mockImplementation((v) => Promise.resolve(v));

      await service.reviewFlag('flag-1', adminId, adminRole, {
        status: AmlFlagStatus.CLEARED,
        resolutionNotes: 'Clean',
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'compliance.aml.flag_reviewed',
        expect.objectContaining({ flagId: 'flag-1' }),
      );
    });
  });

  // ─── Compliance Configuration ───────────────────────────────────────────

  describe('getConfigForRegion', () => {
    it('returns existing config for region', async () => {
      configRepo.findOne.mockResolvedValue({
        ...mockConfig,
        region: ComplianceRegion.US,
      });

      const result = await service.getConfigForRegion('us');
      expect(result.region).toBe(ComplianceRegion.US);
    });

    it('falls back to global config', async () => {
      configRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...mockConfig });

      const result = await service.getConfigForRegion('unknown_region');
      expect(result.region).toBe(ComplianceRegion.GLOBAL);
    });

    it('creates default global config if none exists', async () => {
      configRepo.findOne.mockResolvedValue(null);
      configRepo.create.mockImplementation((v) => ({ id: 'config-new', ...v }));
      configRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.getConfigForRegion('global');
      expect(configRepo.create).toHaveBeenCalled();
      expect(configRepo.save).toHaveBeenCalled();
    });
  });

  describe('listConfigs', () => {
    it('lists all configs', async () => {
      configRepo.find.mockResolvedValue([mockConfig]);
      const result = await service.listConfigs();
      expect(result).toHaveLength(1);
    });
  });

  describe('upsertConfig', () => {
    it('creates a new config', async () => {
      configRepo.findOne.mockResolvedValue(null);
      configRepo.create.mockImplementation((v) => ({ id: 'config-new', ...v }));
      configRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.upsertConfig(
        {
          region: ComplianceRegion.US,
          displayName: 'United States',
        },
        adminId,
        adminRole,
      );

      expect(result).toBeDefined();
      expect(auditRepo.save).toHaveBeenCalled();
    });

    it('updates an existing config', async () => {
      configRepo.findOne.mockResolvedValue({ ...mockConfig });
      configRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.upsertConfig(
        {
          region: ComplianceRegion.GLOBAL,
          blockThresholdScore: 70,
        },
        adminId,
        adminRole,
      );

      expect(result).toBeDefined();
      expect(auditRepo.save).toHaveBeenCalled();
    });
  });

  // ─── Audit Trail ───────────────────────────────────────────────────────

  describe('appendAudit', () => {
    it('creates and saves an audit record', async () => {
      await service.appendAudit({
        performedBy: adminId,
        performedByRole: adminRole,
        targetUserId: userId,
        action: 'kyc.level_update',
        description: 'Updated KYC level',
      });

      expect(auditRepo.create).toHaveBeenCalled();
      expect(auditRepo.save).toHaveBeenCalled();
    });

    it('handles optional fields', async () => {
      await service.appendAudit({
        performedBy: adminId,
        performedByRole: adminRole,
        targetUserId: userId,
        action: 'test.action',
        description: 'Test',
        entityType: 'kyc_verification',
        entityId: 'kyc-1',
        previousState: { level: 'unverified' },
        newState: { level: 'standard' },
        ipAddress: '127.0.0.1',
        metadata: { key: 'value' },
      });

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'kyc_verification',
          entityId: 'kyc-1',
          ipAddress: '127.0.0.1',
        }),
      );
    });
  });

  describe('getAuditTrail', () => {
    it('returns paginated audit logs for user', async () => {
      const qb = createQueryBuilderMock([{ id: 'audit-1' }], 1);
      auditRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAuditTrail(userId);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getAllAuditLogs', () => {
    it('returns all audit logs for admin', async () => {
      const qb = createQueryBuilderMock([{ id: 'audit-1' }], 1);
      auditRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAllAuditLogs();
      expect(result.data).toHaveLength(1);
    });
  });

  // ─── shouldBlockTransactions ────────────────────────────────────────────

  describe('shouldBlockTransactions', () => {
    it('blocks unknown users', async () => {
      kycRepo.findOne.mockResolvedValue(null);
      const result = await service.shouldBlockTransactions(userId);
      expect(result).toBe(true);
    });

    it('blocks users with transactionsBlocked flag', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        transactionsBlocked: true,
      });
      const result = await service.shouldBlockTransactions(userId);
      expect(result).toBe(true);
    });

    it('blocks users with CRITICAL risk level', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        riskLevel: AmlRiskLevel.CRITICAL,
      });
      const result = await service.shouldBlockTransactions(userId);
      expect(result).toBe(true);
    });

    it('blocks users above block threshold score', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        riskScore: 85,
      });
      configRepo.findOne.mockResolvedValue({
        ...mockConfig,
        blockThresholdScore: 80,
      });

      const result = await service.shouldBlockTransactions(userId);
      expect(result).toBe(true);
    });

    it('allows users below block threshold', async () => {
      kycRepo.findOne.mockResolvedValue({
        ...mockVerification,
        riskScore: 30,
      });
      configRepo.findOne.mockResolvedValue({
        ...mockConfig,
        blockThresholdScore: 80,
      });

      const result = await service.shouldBlockTransactions(userId);
      expect(result).toBe(false);
    });
  });
});
