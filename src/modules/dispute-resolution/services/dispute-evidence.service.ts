import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { DisputeEvidence } from '../entities/dispute-evidence.entity';
import { EvidenceStatus } from '../enums/evidence-status.enum';
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_FILE_SIZE,
} from '../constants/dispute.constants';
import { UploadedFilePayload } from '../types/uploaded-file.type';

@Injectable()
export class DisputeEvidenceService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads', 'disputes');

  constructor(
    @InjectRepository(DisputeEvidence)
    private readonly evidenceRepository: Repository<DisputeEvidence>,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  validateFile(mimeType: string, fileSize: number): void {
    if (!ALLOWED_EVIDENCE_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `Invalid file type. Allowed types: ${ALLOWED_EVIDENCE_MIME_TYPES.join(', ')}`,
      );
    }
    if (fileSize > MAX_EVIDENCE_FILE_SIZE) {
      throw new BadRequestException(
        `File size exceeds maximum of ${MAX_EVIDENCE_FILE_SIZE / (1024 * 1024)}MB`,
      );
    }
  }

  async saveEvidence(
    disputeId: string,
    uploadedById: string,
    file: UploadedFilePayload,
    description?: string,
  ): Promise<DisputeEvidence> {
    this.validateFile(file.mimetype, file.size);

    const storagePath = path.join(
      this.uploadDir,
      `${disputeId}-${Date.now()}-${file.originalname}`,
    );
    fs.writeFileSync(storagePath, file.buffer);

    const validationResult = this.analyzeEvidence(file);

    const evidence = this.evidenceRepository.create({
      disputeId,
      uploadedById,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storagePath,
      description: description ?? null,
      status: validationResult.isValid
        ? EvidenceStatus.VALIDATED
        : EvidenceStatus.PENDING,
      validationResult,
    });

    return this.evidenceRepository.save(evidence);
  }

  analyzeEvidence(file: UploadedFilePayload): Record<string, any> {
    const checks = {
      mimeTypeValid: ALLOWED_EVIDENCE_MIME_TYPES.includes(file.mimetype),
      sizeValid: file.size <= MAX_EVIDENCE_FILE_SIZE,
      sizeBytes: file.size,
      mimeType: file.mimetype,
      hasContent: file.size > 0,
    };

    const isValid =
      checks.mimeTypeValid && checks.sizeValid && checks.hasContent;

    return {
      isValid,
      checks,
      analyzedAt: new Date().toISOString(),
      automatedAnalysis: true,
    };
  }

  async findByDispute(disputeId: string): Promise<DisputeEvidence[]> {
    return this.evidenceRepository.find({
      where: { disputeId },
      order: { createdAt: 'ASC' },
    });
  }

  async validateEvidence(evidenceId: string): Promise<DisputeEvidence> {
    const evidence = await this.evidenceRepository.findOne({
      where: { id: evidenceId },
    });
    if (!evidence) {
      throw new BadRequestException(`Evidence ${evidenceId} not found`);
    }
    evidence.status = EvidenceStatus.VALIDATED;
    return this.evidenceRepository.save(evidence);
  }
}
