import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThan, Repository, Not } from 'typeorm';
import { BlockchainEvent } from '../entities/blockchain-event.entity';
import { BlockchainEventType } from '../enums/blockchain-event-type.enum';

interface EventFilters {
  eventType?: BlockchainEventType;
  transactionHash?: string;
  sourceAccount?: string;
  destinationAccount?: string;
  assetCode?: string;
  assetIssuer?: string;
  amountFrom?: number;
  amountTo?: number;
  ledgerFrom?: number;
  ledgerTo?: number;
  startTime?: Date;
  endTime?: Date;
  excludeInvalidated?: boolean;
  skip: number;
  limit: number;
}

@Injectable()
export class EventQueryService {
  private readonly logger = new Logger(EventQueryService.name);

  constructor(
    @InjectRepository(BlockchainEvent)
    private readonly eventRepo: Repository<BlockchainEvent>,
  ) {}

  async findEvents(filters: EventFilters) {
    const qb = this.eventRepo.createQueryBuilder('e');

    if (filters.eventType) {
      qb.andWhere('e.eventType = :eventType', { eventType: filters.eventType });
    }
    if (filters.transactionHash) {
      qb.andWhere('e.transactionHash = :transactionHash', {
        transactionHash: filters.transactionHash,
      });
    }
    if (filters.sourceAccount) {
      qb.andWhere('e.sourceAccount = :sourceAccount', {
        sourceAccount: filters.sourceAccount,
      });
    }
    if (filters.destinationAccount) {
      qb.andWhere('e.destinationAccount = :destinationAccount', {
        destinationAccount: filters.destinationAccount,
      });
    }
    if (filters.assetCode) {
      qb.andWhere('e.assetCode = :assetCode', { assetCode: filters.assetCode });
    }
    if (filters.assetIssuer) {
      qb.andWhere('e.assetIssuer = :assetIssuer', {
        assetIssuer: filters.assetIssuer,
      });
    }
    if (filters.amountFrom !== undefined) {
      qb.andWhere('CAST(e.amount AS NUMERIC) >= :amountFrom', {
        amountFrom: filters.amountFrom,
      });
    }
    if (filters.amountTo !== undefined) {
      qb.andWhere('CAST(e.amount AS NUMERIC) <= :amountTo', {
        amountTo: filters.amountTo,
      });
    }
    if (filters.ledgerFrom !== undefined) {
      qb.andWhere('e.ledger >= :ledgerFrom', {
        ledgerFrom: filters.ledgerFrom,
      });
    }
    if (filters.ledgerTo !== undefined) {
      qb.andWhere('e.ledger <= :ledgerTo', {
        ledgerTo: filters.ledgerTo,
      });
    }
    if (filters.startTime) {
      qb.andWhere('e.timestamp >= :startTime', {
        startTime: filters.startTime,
      });
    }
    if (filters.endTime) {
      qb.andWhere('e.timestamp <= :endTime', { endTime: filters.endTime });
    }
    if (filters.excludeInvalidated !== false) {
      qb.andWhere('e.invalidated = :invalidated', { invalidated: false });
    }

    const total = await qb.getCount();
    qb
      .orderBy('e.ledger', 'DESC')
      .addOrderBy('e.createdAt', 'DESC')
      .offset(filters.skip)
      .limit(filters.limit);

    const events = await qb.getMany();

    return { events, total };
  }

  async findByTransactionHash(txHash: string): Promise<BlockchainEvent[]> {
    return this.eventRepo.find({
      where: { transactionHash: txHash, invalidated: false },
      order: { ledger: 'DESC', createdAt: 'DESC' },
    });
  }

  async findByIdempotencyKeys(uniqueIds: string[]): Promise<BlockchainEvent[]> {
    if (uniqueIds.length === 0) return [];
    return this.eventRepo.find({
      where: uniqueIds.map((id) => ({ uniqueId: id })),
    });
  }
}
