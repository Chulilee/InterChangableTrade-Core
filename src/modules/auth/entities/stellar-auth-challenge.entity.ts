import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/**
 * Short-lived challenge record for Stellar wallet authentication.
 * The client must sign the nonce with their private key within `expiresAt`.
 */
@Entity('stellar_auth_challenges')
export class StellarAuthChallenge extends BaseEntity {
  @Index({ unique: true })
  @Column()
  nonce: string;

  @Index()
  @Column()
  publicKey: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ default: false })
  isUsed: boolean;
}
