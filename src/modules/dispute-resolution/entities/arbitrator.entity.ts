import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { ArbitratorExpertise } from '../enums/arbitrator-expertise.enum';

@Entity('arbitrators')
export class Arbitrator extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: ArbitratorExpertise,
    array: true,
    default: [ArbitratorExpertise.GENERAL],
  })
  expertise: ArbitratorExpertise[];

  @Column({ type: 'boolean', default: true })
  isAvailable: boolean;

  @Column({ type: 'int', default: 0 })
  activeDisputeCount: number;

  @Column({ type: 'int', default: 10 })
  maxActiveDisputes: number;

  @Column({ type: 'int', default: 0 })
  totalResolved: number;
}
