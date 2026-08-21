import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { KycDocumentType } from '../enums/kyc-document-type.enum';
import { KycDocumentStatus } from '../enums/kyc-document-status.enum';

/**
 * A document submitted by a user for KYC verification.
 * Documents are stored with encrypted references; the actual file bytes
 * are kept in encrypted object storage.
 */
@Entity('kyc_documents')
export class KycDocument extends BaseEntity {
  /** The user who uploaded this document */
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  /** Reference to the parent KYC verification record */
  @Index()
  @Column({ type: 'uuid' })
  kycVerificationId: string;

  /** Type of document (ID, address proof, beneficial ownership) */
  @Column({ type: 'enum', enum: KycDocumentType })
  documentType: KycDocumentType;

  /** Current review status */
  @Column({
    type: 'enum',
    enum: KycDocumentStatus,
    default: KycDocumentStatus.PENDING,
  })
  status: KycDocumentStatus;

  /** Original filename as uploaded by the user */
  @Column({ type: 'varchar', length: 256 })
  fileName: string;

  /** MIME type of the uploaded file */
  @Column({ type: 'varchar', length: 128 })
  mimeType: string;

  /** File size in bytes */
  @Column({ type: 'int' })
  fileSize: number;

  /** Encrypted storage path (reference to encrypted object storage) */
  @Column({ type: 'varchar', length: 512 })
  storagePath: string;

  /** Hash of the original file for integrity verification */
  @Column({ type: 'varchar', length: 128 })
  fileHash: string;

  /** Encryption key reference (the actual key is in KMS) */
  @Column({ type: 'varchar', length: 256, nullable: true })
  encryptionKeyId?: string | null;

  /** Reviewer who verified/rejected the document */
  @Column({ type: 'uuid', nullable: true })
  reviewedBy?: string | null;

  /** Timestamp when the document was reviewed */
  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  /** Reason for rejection, if applicable */
  @Column({ type: 'text', nullable: true })
  rejectionReason?: string | null;

  /** Additional metadata (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;
}
