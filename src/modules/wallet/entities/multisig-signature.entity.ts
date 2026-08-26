import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '@app/common';
import { MultisigTransaction } from './multisig-transaction.entity';

/**
 * A single signer's contribution to a pooled multi-signature transaction,
 * stored as a base64 XDR `DecoratedSignature`. The unique
 * `(transactionId, signerPublicKey)` constraint prevents a signer from signing
 * the same transaction twice.
 */
@Entity('multisig_signatures')
@Index(['transactionId', 'signerPublicKey'], { unique: true })
export class MultisigSignature extends BaseEntity {
  @ManyToOne(() => MultisigTransaction, (tx) => tx.signatures, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'transactionId' })
  transaction: MultisigTransaction;

  @Index()
  @Column({ type: 'uuid' })
  transactionId: string;

  /** Public key of the signer that produced this signature. */
  @Column({ type: 'varchar', length: 56 })
  signerPublicKey: string;

  /** Base64-encoded XDR `DecoratedSignature`. */
  @Column({ type: 'text' })
  signatureXdr: string;

  /** The signer's on-chain weight at the time it signed. */
  @Column({ type: 'int' })
  weight: number;

  /** Set when a server-custodied wallet produced this signature. */
  @Column({ type: 'uuid', nullable: true })
  signedByUserId?: string | null;
}
