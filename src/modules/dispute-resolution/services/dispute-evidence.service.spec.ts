import { BadRequestException } from '@nestjs/common';
import { DisputeEvidenceService } from './dispute-evidence.service';
import { EvidenceStatus } from '../enums/evidence-status.enum';
import { UploadedFilePayload } from '../types/uploaded-file.type';
import { MAX_EVIDENCE_FILE_SIZE } from '../constants/dispute.constants';

type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

describe('DisputeEvidenceService', () => {
  let service: DisputeEvidenceService;
  let repo: RepoMock;

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'evidence-1', ...v })),
    };
    service = new DisputeEvidenceService(repo as never);
  });

  describe('validateFile', () => {
    it('accepts allowed mime types', () => {
      expect(() => service.validateFile('application/pdf', 1024)).not.toThrow();
    });

    it('rejects invalid mime types', () => {
      expect(() =>
        service.validateFile('application/x-executable', 1024),
      ).toThrow(BadRequestException);
    });

    it('rejects oversized files', () => {
      expect(() =>
        service.validateFile('application/pdf', MAX_EVIDENCE_FILE_SIZE + 1),
      ).toThrow(BadRequestException);
    });
  });

  describe('analyzeEvidence', () => {
    it('validates correct files', () => {
      const file = {
        mimetype: 'image/png',
        size: 5000,
      } as UploadedFilePayload;

      const result = service.analyzeEvidence(file);

      expect(result.isValid).toBe(true);
      expect(result.automatedAnalysis).toBe(true);
      expect(result.checks.mimeTypeValid).toBe(true);
    });

    it('flags invalid mime types', () => {
      const file = {
        mimetype: 'application/x-bad',
        size: 5000,
      } as UploadedFilePayload;

      const result = service.analyzeEvidence(file);

      expect(result.isValid).toBe(false);
    });
  });

  describe('saveEvidence', () => {
    it('persists evidence with validation result', async () => {
      const file = {
        originalname: 'receipt.pdf',
        mimetype: 'application/pdf',
        size: 2048,
        buffer: Buffer.from('pdf content'),
      } as UploadedFilePayload;

      const result = await service.saveEvidence(
        'dispute-1',
        'user-1',
        file,
        'Transaction receipt',
      );

      expect(result.fileName).toBe('receipt.pdf');
      expect(result.status).toBe(EvidenceStatus.VALIDATED);
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('findByDispute', () => {
    it('returns evidence ordered by creation', async () => {
      repo.find.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);

      const result = await service.findByDispute('dispute-1');

      expect(result).toHaveLength(2);
      expect(repo.find).toHaveBeenCalledWith({
        where: { disputeId: 'dispute-1' },
        order: { createdAt: 'ASC' },
      });
    });
  });
});
