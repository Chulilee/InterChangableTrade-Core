import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('indexer_state')
export class IndexerState {
  @PrimaryColumn({ type: 'varchar' })
  key: string;

  @Column({ type: 'text', nullable: true })
  value: string | null;

  @Column({ type: 'timestamptz' })
  updatedAt: Date;
}
