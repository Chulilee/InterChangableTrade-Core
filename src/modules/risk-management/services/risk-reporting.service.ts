import { Injectable } from '@nestjs/common';
import {
  PortfolioSnapshot,
  RiskBenchmark,
  RiskMetrics,
  RiskReport,
  RiskTrendPoint,
} from '../interfaces/risk.types';

/**
 * Produces exportable risk reports: daily summaries, historical trends and
 * comparisons against a peer group.
 */
@Injectable()
export class RiskReportingService {
  /** Builds a daily summary for the given metrics. */
  dailySummary(
    metrics: RiskMetrics,
    positionCount: number,
    alerts: RiskReport['alerts'],
    topCounterparties: RiskReport['topCounterparties'] = [],
  ): RiskReport {
    return {
      generatedAt: new Date(),
      metrics,
      positionCount,
      alerts,
      topCounterparties,
    };
  }

  /** Ranks counterparties by exposure and annotates each with its share. */
  topCounterparties(
    exposures: Array<{ counterparty: string; exposure: number }>,
    limit = 5,
  ): RiskReport['topCounterparties'] {
    const total = exposures.reduce((sum, entry) => sum + entry.exposure, 0);
    return [...exposures]
      .sort((a, b) => b.exposure - a.exposure)
      .slice(0, limit)
      .map((entry) => ({
        counterparty: entry.counterparty,
        exposure: entry.exposure,
        share: total === 0 ? 0 : entry.exposure / total,
      }));
  }

  /** Converts a series of snapshots into a risk trend. */
  trend(snapshots: PortfolioSnapshot[]): RiskTrendPoint[] {
    return [...snapshots]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((snapshot) => ({
        timestamp: snapshot.timestamp,
        portfolioValue: snapshot.positions.reduce(
          (sum, position) =>
            sum + Math.abs(position.quantity) * position.currentPrice,
          0,
        ),
        var95: 0,
        var99: 0,
      }));
  }

  /**
   * Compares a portfolio against a peer group. The percentile expresses how
   * the subject's 99% VaR compares with the peers (100% = least risky).
   */
  benchmark(subject: RiskMetrics, peers: RiskMetrics[]): RiskBenchmark {
    if (peers.length === 0) {
      return {
        subject,
        peerAverage: { var95: 0, var99: 0, concentration: 0 },
        percentile: 100,
      };
    }

    const peerAverage = {
      var95: this.average(peers.map((peer) => peer.var95)),
      var99: this.average(peers.map((peer) => peer.var99)),
      concentration: this.average(
        peers.map((peer) => peer.concentration.topAssetShare),
      ),
    };

    const saferThan = peers.filter((peer) => peer.var99 > subject.var99).length;
    const percentile = (saferThan / peers.length) * 100;

    return { subject, peerAverage, percentile };
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}
