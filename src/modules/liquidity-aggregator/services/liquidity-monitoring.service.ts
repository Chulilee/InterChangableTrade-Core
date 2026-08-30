import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import {
  LiquidityPool,
  PoolStatus,
} from '../entities/liquidity-pool.entity';
import { PoolSnapshot } from '../entities/pool-snapshot.entity';
import {
  ArbitrageOpportunity,
  ArbitrageStatus,
} from '../entities/arbitrage-opportunity.entity';

export interface PoolAlert {
  poolId: string;
  poolName: string;
  alertType: 'imbalance' | 'tvl_drop' | 'volume_spike' | 'fee_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  currentValue: number;
  threshold: number;
  detectedAt: Date;
}

export interface ArbitrageScanResult {
  opportunitiesFound: number;
  totalEstimatedProfit: number;
  opportunities: ArbitrageOpportunity[];
  scannedAt: Date;
}

/**
 * Monitors pool health, detects imbalances, and identifies arbitrage
 * opportunities across the pool ecosystem.
 */
@Injectable()
export class LiquidityMonitoringService {
  private readonly logger = new Logger(LiquidityMonitoringService.name);

  // Alert thresholds
  private readonly TVL_DROP_THRESHOLD = 0.10; // 10% drop
  private readonly VOLUME_SPIKE_THRESHOLD = 3.0; // 3x normal
  private readonly FEE_ANOMALY_THRESHOLD = 0.02; // 2% fee vs normal
  private readonly IMBALANCE_THRESHOLD = 0.7; // 70/30 reserve ratio
  private readonly MIN_ARB_SPREAD = 0.1; // 0.1% minimum for arb

  constructor(
    @InjectRepository(LiquidityPool)
    private readonly poolRepository: Repository<LiquidityPool>,
    @InjectRepository(PoolSnapshot)
    private readonly snapshotRepository: Repository<PoolSnapshot>,
    @InjectRepository(ArbitrageOpportunity)
    private readonly arbRepository: Repository<ArbitrageOpportunity>,
  ) {}

  // ─── Pool Health Monitoring ──────────────────────────────────────────────

  /**
   * Scan all active pools for anomalies and return alerts.
   */
  async scanPoolHealth(): Promise<PoolAlert[]> {
    const alerts: PoolAlert[] = [];
    const pools = await this.poolRepository.find({
      where: { status: PoolStatus.ACTIVE },
    });

    for (const pool of pools) {
      const poolAlerts = await this.checkPoolAnomalies(pool);
      alerts.push(...poolAlerts);
    }

    if (alerts.length > 0) {
      this.logger.warn(
        `Pool health scan found ${alerts.length} alerts across ${pools.length} pools`,
      );
    }

    return alerts;
  }

  private async checkPoolAnomalies(
    pool: LiquidityPool,
  ): Promise<PoolAlert[]> {
    const alerts: PoolAlert[] = [];
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get recent snapshots
    const recentSnapshots = await this.snapshotRepository.find({
      where: { poolId: pool.id },
      order: { snapshotAt: 'DESC' },
      take: 48,
    });

    if (recentSnapshots.length < 2) return alerts;

    const latest = recentSnapshots[0];
    const tvlNow = parseFloat(latest.tvl);

    // 1. TVL drop detection
    const tvl24hAgo = this.findSnapshotAt(recentSnapshots, oneDayAgo);
    if (tvl24hAgo) {
      const prevTvl = parseFloat(tvl24hAgo.tvl);
      if (prevTvl > 0) {
        const tvlChange = (prevTvl - tvlNow) / prevTvl;
        if (tvlChange > this.TVL_DROP_THRESHOLD) {
          alerts.push({
            poolId: pool.id,
            poolName: pool.name,
            alertType: 'tvl_drop',
            severity: tvlChange > 0.25 ? 'critical' : tvlChange > 0.15 ? 'high' : 'medium',
            message: `TVL dropped ${(tvlChange * 100).toFixed(1)}% in 24h`,
            currentValue: tvlNow,
            threshold: prevTvl * (1 - this.TVL_DROP_THRESHOLD),
            detectedAt: now,
          });
        }
      }
    }

    // 2. Volume spike detection
    const avgVolume = this.averageOverPeriod(recentSnapshots.slice(1, 25), 'volume24h');
    const currentVolume = parseFloat(latest.volume24h);
    if (avgVolume > 0 && currentVolume > avgVolume * this.VOLUME_SPIKE_THRESHOLD) {
      alerts.push({
        poolId: pool.id,
        poolName: pool.name,
        alertType: 'volume_spike',
        severity: 'medium',
        message: `Volume ${(currentVolume / avgVolume).toFixed(1)}x above 24h average`,
        currentValue: currentVolume,
        threshold: avgVolume * this.VOLUME_SPIKE_THRESHOLD,
        detectedAt: now,
      });
    }

    // 3. Reserve imbalance detection
    const reserveA = parseFloat(latest.reserveA);
    const reserveB = parseFloat(latest.reserveB);
    if (reserveA > 0 && reserveB > 0) {
      const ratio = reserveA / (reserveA + reserveB);
      if (ratio > this.IMBALANCE_THRESHOLD || ratio < 1 - this.IMBALANCE_THRESHOLD) {
        alerts.push({
          poolId: pool.id,
          poolName: pool.name,
          alertType: 'imbalance',
          severity: 'low',
          message: `Reserve ratio ${ratio > 0.5 ? `${(ratio * 100).toFixed(0)}%/${((1 - ratio) * 100).toFixed(0)}%` : `${((1 - ratio) * 100).toFixed(0)}%/${(ratio * 100).toFixed(0)}%`}`,
          currentValue: ratio,
          threshold: this.IMBALANCE_THRESHOLD,
          detectedAt: now,
        });
      }
    }

    return alerts;
  }

  // ─── Arbitrage Detection ─────────────────────────────────────────────────

  /**
   * Scan all active pools for arbitrage opportunities between pairs of
   * pools that share a common asset.
   */
  async scanArbitrage(minSpreadPercent = this.MIN_ARB_SPREAD): Promise<ArbitrageScanResult> {
    const startTime = Date.now();
    const pools = await this.poolRepository.find({
      where: { status: PoolStatus.ACTIVE },
    });

    // Group pools by asset pair (normalized so "A-B" and "B-A" hash the same)
    const pairGroups = this.groupPoolsByAssetPair(pools);
    const opportunities: ArbitrageOpportunity[] = [];

    for (const [pairKey, pairPools] of pairGroups) {
      if (pairPools.length < 2) continue;

      const arbs = this.findArbitrageInPair(pairPools, minSpreadPercent);
      opportunities.push(...arbs);
    }

    // Also check triangular arbitrage (A→B→C→A cycles)
    const triangularArbs = this.findTriangularArbitrage(pools, minSpreadPercent);
    opportunities.push(...triangularArbs);

    // Persist new opportunities
    const saved = await this.arbRepository.save(opportunities);

    const totalProfit = saved.reduce(
      (sum, o) => sum + parseFloat(o.estimatedProfit),
      0,
    );

    this.logger.log(
      `Arbitrage scan completed in ${Date.now() - startTime}ms: ${saved.length} opportunities, total profit: ${totalProfit.toFixed(4)}`,
    );

    return {
      opportunitiesFound: saved.length,
      totalEstimatedProfit: totalProfit,
      opportunities: saved,
      scannedAt: new Date(),
    };
  }

  /**
   * Get active (non-expired) arbitrage opportunities.
   */
  async getActiveOpportunities(
    page = 1,
    limit = 20,
  ): Promise<{ data: ArbitrageOpportunity[]; total: number }> {
    const [data, total] = await this.arbRepository.findAndCount({
      where: {
        status: ArbitrageStatus.DETECTED,
        expiresAt: MoreThan(new Date()),
      },
      order: { estimatedProfit: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private groupPoolsByAssetPair(
    pools: LiquidityPool[],
  ): Map<string, LiquidityPool[]> {
    const groups = new Map<string, LiquidityPool[]>();
    for (const pool of pools) {
      const key = [pool.assetCodeA, pool.assetCodeB].sort().join('-');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(pool);
    }
    return groups;
  }

  private findArbitrageInPair(
    pools: LiquidityPool[],
    minSpread: number,
  ): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const now = new Date();
    const ttl = 5 * 60 * 1000; // 5-minute TTL

    for (let i = 0; i < pools.length; i++) {
      for (let j = i + 1; j < pools.length; j++) {
        const a = pools[i];
        const b = pools[j];

        const priceA = this.getPoolPrice(a);
        const priceB = this.getPoolPrice(b);

        if (priceA <= 0 || priceB <= 0) continue;

        // Spread: how much cheaper is one pool vs the other
        const spread = Math.abs(priceA - priceB) / Math.min(priceA, priceB);
        const spreadPercent = spread * 100;

        if (spreadPercent >= minSpread) {
          const cheaperPool = priceA < priceB ? a : b;
          const expensivePool = priceA < priceB ? b : a;

          // Max profitable size: where price convergence happens
          const tvlMin = Math.min(
            parseFloat(cheaperPool.tvl),
            parseFloat(expensivePool.tvl),
          );
          const maxProfitable = tvlMin * spread * 0.5;

          opportunities.push(
            this.arbRepository.create({
              baseAsset: cheaperPool.assetCodeA,
              quoteAsset: cheaperPool.assetCodeB,
              cyclePools: [cheaperPool.id, expensivePool.id],
              estimatedProfit: (maxProfitable * spread).toString(),
              maxProfitableSize: maxProfitable.toString(),
              spreadPercent: spreadPercent.toFixed(6),
              estimatedGasCost: '200000',
              status: ArbitrageStatus.DETECTED,
              detectedAt: now,
              expiresAt: new Date(now.getTime() + ttl),
            }),
          );
        }
      }
    }

    return opportunities;
  }

  /**
   * Detect triangular arbitrage: A→B→C→A cycles where the product of
   * exchange rates exceeds 1 (after fees).
   */
  private findTriangularArbitrage(
    pools: LiquidityPool[],
    minSpread: number,
  ): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const now = new Date();
    const ttl = 5 * 60 * 1000;

    // Build adjacency: asset → [(neighbor, pool, rate)]
    const adj = new Map<string, Array<{ neighbor: string; pool: LiquidityPool; rate: number }>>();

    for (const pool of pools) {
      const rateAB = this.getPoolRate(pool, pool.assetCodeA, pool.assetCodeB);
      const rateBA = this.getPoolRate(pool, pool.assetCodeB, pool.assetCodeA);

      if (!adj.has(pool.assetCodeA)) adj.set(pool.assetCodeA, []);
      if (!adj.has(pool.assetCodeB)) adj.set(pool.assetCodeB, []);

      if (rateAB > 0) {
        adj.get(pool.assetCodeA)!.push({ neighbor: pool.assetCodeB, pool, rate: rateAB });
      }
      if (rateBA > 0) {
        adj.get(pool.assetCodeB)!.push({ neighbor: pool.assetCodeA, pool, rate: rateBA });
      }
    }

    // DFS depth 3 to find cycles
    const assets = Array.from(adj.keys());
    for (const start of assets) {
      const neighbors = adj.get(start) ?? [];
      for (const n1 of neighbors) {
        const n2s = adj.get(n1.neighbor) ?? [];
        for (const n2 of n2s) {
          if (n2.neighbor === start || n2.pool.id === n1.pool.id) continue;
          const n3s = adj.get(n2.neighbor) ?? [];
          for (const n3 of n3s) {
            if (n3.neighbor !== start || n3.pool.id === n1.pool.id || n3.pool.id === n2.pool.id) continue;

            const cycleRate = n1.rate * n2.rate * n3.rate;
            const spreadPercent = (cycleRate - 1) * 100;

            if (spreadPercent >= minSpread) {
              const tvlMin = Math.min(
                parseFloat(n1.pool.tvl),
                parseFloat(n2.pool.tvl),
                parseFloat(n3.pool.tvl),
              );
              const maxProfitable = tvlMin * (cycleRate - 1) * 0.3;

              opportunities.push(
                this.arbRepository.create({
                  baseAsset: start,
                  quoteAsset: n1.neighbor,
                  cyclePools: [n1.pool.id, n2.pool.id, n3.pool.id],
                  estimatedProfit: (maxProfitable * (cycleRate - 1)).toString(),
                  maxProfitableSize: maxProfitable.toString(),
                  spreadPercent: spreadPercent.toFixed(6),
                  estimatedGasCost: '300000',
                  status: ArbitrageStatus.DETECTED,
                  detectedAt: now,
                  expiresAt: new Date(now.getTime() + ttl),
                }),
              );
            }
          }
        }
      }
    }

    return opportunities;
  }

  private getPoolPrice(pool: LiquidityPool): number {
    const tvl = parseFloat(pool.tvl);
    if (tvl <= 0) return 0;
    return parseFloat(pool.volume24h) / tvl || parseFloat(pool.feeRate);
  }

  private getPoolRate(
    pool: LiquidityPool,
    from: string,
    to: string,
  ): number {
    if (pool.assetCodeA === from && pool.assetCodeB === to) {
      return 1 / (1 + parseFloat(pool.feeRate));
    }
    if (pool.assetCodeB === from && pool.assetCodeA === to) {
      return 1 / (1 + parseFloat(pool.feeRate));
    }
    return 0;
  }

  private findSnapshotAt(
    snapshots: PoolSnapshot[],
    target: Date,
  ): PoolSnapshot | null {
    let closest = snapshots[0];
    let minDiff = Math.abs(closest.snapshotAt.getTime() - target.getTime());
    for (const s of snapshots) {
      const diff = Math.abs(s.snapshotAt.getTime() - target.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closest = s;
      }
    }
    return minDiff < 2 * 60 * 60 * 1000 ? closest : null; // Within 2 hours
  }

  private averageOverPeriod(
    snapshots: PoolSnapshot[],
    field: keyof PoolSnapshot,
  ): number {
    if (snapshots.length === 0) return 0;
    const sum = snapshots.reduce(
      (s, snap) => s + parseFloat(String(snap[field])),
      0,
    );
    return sum / snapshots.length;
  }
}
