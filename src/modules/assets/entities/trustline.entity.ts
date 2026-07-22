import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from '@app/common';
import { User } from '../../users/entities/user.entity';
import { Asset } from './asset.entity';

@Entity('trustlines')
export class TrustLine extends BaseEntity {
  @ManyToOne(() => User)
  user: User;

  @ManyToOne(() => Asset)
  asset: Asset;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  balance: string;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  limit: string;
}
