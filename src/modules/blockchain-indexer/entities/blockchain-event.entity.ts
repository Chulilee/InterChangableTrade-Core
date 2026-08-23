import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum BlockchainEventType {
  PAYMENT = 'payment',
  PATH_PAYMENT_STRICT_RECEIVE = 'path_payment_strict_receive',
  PATH_PAYMENT_STRICT_SEND = 'path_payment_strict_send',
  MANAGE_OFFER = 'manage_offer',
  MANAGE_OFFER_WITHDRAW = 'manage_offer_withdraw',
  CREATE_ACCOUNT = 'create_account',
  ACCOUNT_MERGE = 'account_merge',
  TRANSACTION = 'transaction',
  // Soroban contract event types
  SOROBAN_CONTRACT_INVOCATION = 'soroban_contract_invocation',
  SOROBAN_CONTRACT_EVENT = 'soroban_contract_event',
  SOROBAN_SYSTEM_EVENT = 'soroban_system_event',
  SOROBAN_DIAGNOSTIC_EVENT = 'soroban_diagnostic_event',
}

@Entity('blockchain_events')
@Index(['transactionHash', 'createdAt'])
@Index(['sourceAccount', 'ledger'])
@Index(['ledger', 'eventType'])
@Index(['timestamp'])
export class BlockchainEvent extends BaseEntity {
  @Column({ type: 'varchar' })
  uniqueId: string;

  @Column({ type: 'varchar' })
  eventType: string;

  @Column({ type: 'varchar' })
  transactionHash: string;

  @Column({ type: 'numeric' })
  ledger: number;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'varchar' })
  sourceAccount: string;

  @Column({ type: 'varchar', nullable: true })
  destinationAccount?: string;

  @Column({ type: 'varchar' })
  assetCode: string;

  @Column({ type: 'varchar', nullable: true })
  assetIssuer?: string;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  amount: string;

  @Column({ type: 'jsonb', nullable: true })
  raw?: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  invalidated: boolean;
}
