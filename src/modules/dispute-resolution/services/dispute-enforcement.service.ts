import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute } from '../entities/dispute.entity';
import { DisputeResolutionType } from '../enums/dispute-resolution-type.enum';
import { TransactionsService } from '../../transactions/transactions.service';
import {
  TransactionStatus,
  TransactionType,
} from '../../transactions/entities/transaction.entity';
import { Trade } from '../../trading-engine/entities/trade.entity';

@Injectable()
export class DisputeEnforcementService {
  private readonly logger = new Logger(DisputeEnforcementService.name);

  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly transactionsService: TransactionsService,
  ) {}

  async executeEnforcement(dispute: Dispute): Promise<void> {
    if (dispute.enforcementExecuted) {
      return;
    }

    if (dispute.resolutionType === DisputeResolutionType.DISMISSED) {
      dispute.enforcementExecuted = true;
      await this.disputeRepository.save(dispute);
      return;
    }

    const trade = await this.tradeRepository.findOne({
      where: { id: dispute.tradeId },
    });
    if (!trade) {
      this.logger.warn(
        `Trade ${dispute.tradeId} not found for dispute ${dispute.id} enforcement`,
      );
      return;
    }

    const amount = dispute.resolutionAmount ?? trade.quantity;
    const recipientId = dispute.complainantId;

    switch (dispute.resolutionType) {
      case DisputeResolutionType.REFUND:
        await this.createRemediationTransaction(
          recipientId,
          trade.assetCode,
          trade.assetIssuer,
          amount,
          `Refund for dispute ${dispute.id}`,
          dispute.id,
        );
        break;

      case DisputeResolutionType.REVERSAL:
        await this.createRemediationTransaction(
          dispute.respondentId,
          trade.assetCode,
          trade.assetIssuer,
          amount,
          `Reversal for dispute ${dispute.id}`,
          dispute.id,
        );
        break;

      case DisputeResolutionType.SETTLEMENT:
        await this.createRemediationTransaction(
          recipientId,
          trade.assetCode,
          trade.assetIssuer,
          amount,
          `Settlement for dispute ${dispute.id}`,
          dispute.id,
        );
        break;
    }

    dispute.enforcementExecuted = true;
    await this.disputeRepository.save(dispute);
  }

  private async createRemediationTransaction(
    userId: string,
    assetCode: string,
    assetIssuer: string | null | undefined,
    amount: string,
    memo: string,
    disputeId: string,
  ): Promise<void> {
    await this.transactionsService.record({
      userId,
      type: TransactionType.OTHER,
      status: TransactionStatus.PENDING,
      assetCode,
      assetIssuer: assetIssuer ?? undefined,
      amount,
      fromAccount: 'dispute-resolution',
      toAccount: userId,
    });

    this.logger.log(
      `Enforcement transaction created for dispute ${disputeId}: ${memo}`,
    );
  }
}
