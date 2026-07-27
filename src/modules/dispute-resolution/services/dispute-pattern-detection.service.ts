import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Dispute } from '../entities/dispute.entity';
import { DisputeStatus } from '../enums/dispute-status.enum';

export interface SimilarDisputeMatch {
  disputeId: string;
  tradeId: string;
  classification: string;
  status: string;
  similarityScore: number;
  matchReasons: string[];
}

@Injectable()
export class DisputePatternDetectionService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
  ) {}

  async detectSimilarDisputes(
    dispute: Dispute,
  ): Promise<SimilarDisputeMatch[]> {
    const candidates = await this.disputeRepository.find({
      where: {
        id: Not(dispute.id),
        classification: dispute.classification,
      },
    });

    const matches: SimilarDisputeMatch[] = [];

    for (const candidate of candidates) {
      const matchReasons: string[] = [];
      let score = 0;

      if (candidate.tradeId === dispute.tradeId) {
        matchReasons.push('same_trade');
        score += 50;
      }

      if (
        candidate.complainantId === dispute.complainantId ||
        candidate.respondentId === dispute.respondentId
      ) {
        matchReasons.push('same_party');
        score += 30;
      }

      if (candidate.classification === dispute.classification) {
        matchReasons.push('same_classification');
        score += 20;
      }

      if (candidate.status !== DisputeStatus.REJECTED) {
        score += 10;
      }

      if (score >= 30) {
        matches.push({
          disputeId: candidate.id,
          tradeId: candidate.tradeId,
          classification: candidate.classification,
          status: candidate.status,
          similarityScore: score,
          matchReasons,
        });
      }
    }

    return matches.sort((a, b) => b.similarityScore - a.similarityScore);
  }

  async flagIfSimilar(dispute: Dispute): Promise<boolean> {
    const similar = await this.detectSimilarDisputes(dispute);
    if (similar.length > 0) {
      dispute.similarDisputesFlagged = true;
      dispute.metadata = {
        ...dispute.metadata,
        similarDisputes: similar.slice(0, 5),
      };
      await this.disputeRepository.save(dispute);
      return true;
    }
    return false;
  }
}
