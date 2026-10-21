import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('indexer_state')
export class IndexerState {
  @PrimaryColumn({ type: 'varchar' })
  key: string;

  @Column({ type: 'text', nullable: true })
  value: string | null;

  /**
   * Hash of the ledger referenced by this state entry, when the value points at
   * a specific ledger (for example `last_indexed_ledger`). Persisting the hash
   * lets the reorg handler distinguish "same sequence, different ledger" from a
   * normal forward progress.
   */
  @Column({ name: 'ledger_hash', type: 'varchar', nullable: true })
  ledgerHash: string | null;

  @Column({ type: 'timestamptz' })
  updatedAt: Date;
}
