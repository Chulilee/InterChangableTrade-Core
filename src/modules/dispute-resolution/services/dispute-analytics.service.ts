import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Dispute } from '../entities/dispute.entity';
import { DisputeStatus } from '../enums/dispute-status.enum';
import { DisputeClassification } from '../enums/dispute-classification.enum';

export interface DisputeMetrics {
  totalDisputes: number;
  openDisputes: number;
  resolvedDisputes: number;
  appealedDisputes: number;
  rejectedDisputes: number;
  averageResolutionDays: number;
  slaComplianceRate: number;
  byClassification: Record<string, number>;
  byStatus: Record<string, number>;
  trends: DisputeTrendPoint[];
}

export interface DisputeTrendPoint {
  period: string;
  filed: number;
  resolved: number;
}

@Injectable()
export class DisputeAnalyticsService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
  ) {}

  async getDashboardMetrics(): Promise<DisputeMetrics> {
    const allDisputes = await this.disputeRepository.find();

    const openStatuses = [
      DisputeStatus.FILED,
      DisputeStatus.UNDER_REVIEW,
      DisputeStatus.INVESTIGATION,
      DisputeStatus.ARBITRATION,
      DisputeStatus.APPEALED,
    ];

    const openDisputes = allDisputes.filter((d) =>
      openStatuses.includes(d.status),
    );
    const resolvedDisputes = allDisputes.filter(
      (d) =>
        d.status === DisputeStatus.RESOLVED ||
        d.status === DisputeStatus.CLOSED,
    );
    const appealedDisputes = allDisputes.filter((d) => d.appealed);
    const rejectedDisputes = allDisputes.filter(
      (d) => d.status === DisputeStatus.REJECTED,
    );

    const resolutionTimes = resolvedDisputes
      .filter((d) => d.resolvedAt)
      .map(
        (d) =>
          (d.resolvedAt!.getTime() - d.createdAt.getTime()) /
          (1000 * 60 * 60 * 24),
      );

    const averageResolutionDays =
      resolutionTimes.length > 0
        ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
        : 0;

    const slaCompliant = resolvedDisputes.filter(
      (d) => d.resolvedAt && d.resolvedAt <= d.resolutionDeadline,
    );
    const slaComplianceRate =
      resolvedDisputes.length > 0
        ? (slaCompliant.length / resolvedDisputes.length) * 100
        : 100;

    const byClassification: Record<string, number> = {};
    for (const cls of Object.values(DisputeClassification)) {
      byClassification[cls] = allDisputes.filter(
        (d) => d.classification === cls,
      ).length;
    }

    const byStatus: Record<string, number> = {};
    for (const status of Object.values(DisputeStatus)) {
      byStatus[status] = allDisputes.filter((d) => d.status === status).length;
    }

    const trends = await this.getTrends(6);

    return {
      totalDisputes: allDisputes.length,
      openDisputes: openDisputes.length,
      resolvedDisputes: resolvedDisputes.length,
      appealedDisputes: appealedDisputes.length,
      rejectedDisputes: rejectedDisputes.length,
      averageResolutionDays: Math.round(averageResolutionDays * 100) / 100,
      slaComplianceRate: Math.round(slaComplianceRate * 100) / 100,
      byClassification,
      byStatus,
      trends,
    };
  }

  async getTrends(months: number): Promise<DisputeTrendPoint[]> {
    const trends: DisputeTrendPoint[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(
        now.getFullYear(),
        now.getMonth() - i + 1,
        0,
        23,
        59,
        59,
      );

      const filed = await this.disputeRepository.count({
        where: { createdAt: Between(start, end) },
      });

      const resolved = await this.disputeRepository.count({
        where: {
          resolvedAt: Between(start, end),
          status: DisputeStatus.RESOLVED,
        },
      });

      trends.push({
        period: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        filed,
        resolved,
      });
    }

    return trends;
  }
}
