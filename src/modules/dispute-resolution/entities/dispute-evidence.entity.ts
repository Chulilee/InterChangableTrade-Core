import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { EvidenceStatus } from '../enums/evidence-status.enum';

@Entity('dispute_evidence')
export class DisputeEvidence extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  disputeId: string;

  @Index()
  @Column({ type: 'uuid' })
  uploadedById: string;

  @Column({ type: 'varchar' })
  fileName: string;

  @Column({ type: 'varchar' })
  mimeType: string;

  @Column({ type: 'int' })
  fileSize: number;

  @Column({ type: 'varchar' })
  storagePath: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({
    type: 'enum',
    enum: EvidenceStatus,
    default: EvidenceStatus.PENDING,
  })
  status: EvidenceStatus;

  @Column({ type: 'jsonb', nullable: true })
  validationResult?: Record<string, any> | null;
}
