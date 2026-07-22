import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginatedResultDto } from '@app/common';
import { Transaction, TransactionStatus } from './entities/transaction.entity';
import { RecordTransactionDto } from './dto/record-transaction.dto';
import { QueryTransactionDto } from './dto/query-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
  ) {}

  async record(dto: RecordTransactionDto): Promise<Transaction> {
    const transaction = this.transactionsRepository.create({
      ...dto,
      userId: dto.userId ?? null,
      assetIssuer: dto.assetIssuer ?? null,
      listingId: dto.listingId ?? null,
      status: dto.status ?? TransactionStatus.PENDING,
    });
    return this.transactionsRepository.save(transaction);
  }

  async findAll(
    query: QueryTransactionDto,
  ): Promise<PaginatedResultDto<Transaction>> {
    const qb = this.transactionsRepository
      .createQueryBuilder('tx')
      .orderBy('tx.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.type) {
      qb.andWhere('tx.type = :type', { type: query.type });
    }
    if (query.status) {
      qb.andWhere('tx.status = :status', { status: query.status });
    }
    if (query.userId) {
      qb.andWhere('tx.userId = :userId', { userId: query.userId });
    }
    if (query.assetCode) {
      qb.andWhere('tx.assetCode = :assetCode', {
        assetCode: query.assetCode,
      });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<Transaction> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id },
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }
    return transaction;
  }

  /**
   * Convenience accessor for a single user's history, used by the "my
   * transactions" endpoint.
   */
  async findForUser(
    userId: string,
    query: QueryTransactionDto,
  ): Promise<PaginatedResultDto<Transaction>> {
    query.userId = userId;
    return this.findAll(query);
  }
}
