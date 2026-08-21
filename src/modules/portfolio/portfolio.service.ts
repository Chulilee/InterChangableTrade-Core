import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, IsNull } from 'typeorm';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';
import { PerformanceTimeFrame } from './dto/portfolio-query.dto';
import { Wallet } from '../wallet/entities/wallet.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { Trade } from '../trading-engine/entities/trade.entity';
import { Asset } from '../assets/entities/asset.entity';
import { TrustLine } from '../assets/entities/trustline.entity';

export interface AssetHolding {
  assetCode: string;
  assetIssuer: string | null;
  balance: string;
  currentPriceUsd: number;
  valueUsd: number;
  change24h: number;
  allocation: number;
}

export interface PerformanceMetrics {
  timeframe: PerformanceTimeFrame;
  currentValueUsd: number;
  previousValueUsd: number;
  absoluteReturn: number;
  percentReturn: number;
}

export interface AllocationBreakdown {
  byAsset: Array<{
    assetCode: string;
    valueUsd: number;
    percent: number;
  }>;
  byType: Array<{
    type: string;
    valueUsd: number;
    percent: number;
  }>;
}

export interface PortfolioDashboard {
  summary: {
    totalValueUsd: number;
    totalAssets: number;
    totalWallets: number;
    dailyChangeUsd: number;
    dailyChangePercent: number;
    asOfMonth: string;
  };
  holdings: AssetHolding[];
  performance: PerformanceMetrics[];
  allocation: AllocationBreakdown;
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    @InjectRepository(PortfolioSnapshot)
    private readonly snapshotRepository: Repository<PortfolioSnapshot>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(Asset)
    private readonly assetRepository: Repository<Asset>,
    @InjectRepository(TrustLine)
    private readonly trustlineRepository: Repository<TrustLine>,
  ) {}

  /**
   * Returns the complete portfolio dashboard for a user, including summary,
   * holdings, performance metrics, and allocation breakdown.
   */
  async getDashboard(
    userId: string,
    timeFrame: PerformanceTimeFrame = PerformanceTimeFrame.ALL_TIME,
  ): Promise<PortfolioDashboard> {
    const wallets = await this.walletRepository.find({
      where: { userId },
      order: { isPrimary: 'DESC' },
    });

    const trustlines = await this.trustlineRepository.find({
      where: { user: { id: userId } },
      relations: ['asset'],
    });

    const holdings = await this.buildHoldings(wallets, trustlines);
    const totalValueUsd = holdings.reduce((sum, h) => sum + h.valueUsd, 0);

    const summary = await this.buildSummary(
      userId,
      wallets,
      holdings,
      totalValueUsd,
    );

    const performance = await this.calculatePerformance(
      userId,
      timeFrame,
      totalValueUsd,
    );

    const allocation = this.buildAllocation(holdings, totalValueUsd);

    return { summary, holdings, performance, allocation };
  }

  /**
   * Creates or updates a portfolio snapshot for historical tracking.
   */
  async createSnapshot(userId: string): Promise<PortfolioSnapshot> {
    const wallets = await this.walletRepository.find({ where: { userId } });
    const trustlines = await this.trustlineRepository.find({
      where: { user: { id: userId } },
      relations: ['asset'],
    });

    const holdings = await this.buildHoldings(wallets, trustlines);
    const totalValueUsd = holdings.reduce((sum, h) => sum + h.valueUsd, 0);

    const holdingsMap: Record<string, string> = {};
    for (const h of holdings) {
      holdingsMap[h.assetCode] = h.balance;
    }

    const snapshot = this.snapshotRepository.create({
      userId,
      snapshotDate: new Date(),
      totalValueUsd: totalValueUsd.toString(),
      assetCount: holdings.length,
      holdings: holdingsMap,
    });

    return this.snapshotRepository.save(snapshot);
  }

  /**
   * Returns historical snapshots for the user within a time range.
   */
  async getSnapshots(
    userId: string,
    timeFrame: PerformanceTimeFrame,
  ): Promise<PortfolioSnapshot[]> {
    const since = this.getTimeFrameStart(timeFrame);

    return this.snapshotRepository.find({
      where: {
        userId,
        snapshotDate: MoreThanOrEqual(since),
      },
      order: { snapshotDate: 'ASC' },
    });
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private async buildHoldings(
    wallets: Wallet[],
    trustlines: TrustLine[],
  ): Promise<AssetHolding[]> {
    const holdings: AssetHolding[] = [];

    // Native XLM from wallets
    for (const wallet of wallets) {
      const balance = parseFloat(wallet.cachedBalance ?? '0');
      if (balance > 0) {
        const xlmPrice = await this.getAssetPrice('XLM', null);
        const valueUsd = balance * xlmPrice;

        holdings.push({
          assetCode: 'XLM',
          assetIssuer: null,
          balance: wallet.cachedBalance ?? '0',
          currentPriceUsd: xlmPrice,
          valueUsd,
          change24h: 0,
          allocation: 0,
        });
      }
    }

    // Trust lines
    for (const tl of trustlines) {
      const balance = parseFloat(tl.balance ?? '0');
      if (balance > 0) {
        const asset = tl.asset;
        const price = await this.getAssetPrice(
          asset.code,
          asset.issuer ?? null,
        );
        const valueUsd = balance * price;

        holdings.push({
          assetCode: asset.code,
          assetIssuer: asset.issuer ?? null,
          balance: tl.balance,
          currentPriceUsd: price,
          valueUsd,
          change24h: 0,
          allocation: 0,
        });
      }
    }

    // Deduplicate XLM entries (sum balances from multiple wallets)
    const merged = this.mergeHoldings(holdings);

    // Calculate allocations
    const totalValue = merged.reduce((s, h) => s + h.valueUsd, 0);
    for (const h of merged) {
      h.allocation = totalValue > 0 ? (h.valueUsd / totalValue) * 100 : 0;
    }

    return merged;
  }

  private mergeHoldings(holdings: AssetHolding[]): AssetHolding[] {
    const map = new Map<string, AssetHolding>();

    for (const h of holdings) {
      const key = h.assetIssuer
        ? `${h.assetCode}:${h.assetIssuer}`
        : h.assetCode;

      if (map.has(key)) {
        const existing = map.get(key)!;
        const mergedBalance =
          parseFloat(existing.balance) + parseFloat(h.balance);
        existing.balance = mergedBalance.toString();
        existing.valueUsd += h.valueUsd;
        existing.currentPriceUsd = h.currentPriceUsd;
      } else {
        map.set(key, { ...h });
      }
    }

    return Array.from(map.values());
  }

  private async buildSummary(
    userId: string,
    wallets: Wallet[],
    holdings: AssetHolding[],
    totalValueUsd: number,
  ) {
    // Get yesterday's snapshot for daily change
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const previousSnapshot = await this.snapshotRepository.findOne({
      where: {
        userId,
        snapshotDate: MoreThanOrEqual(yesterday),
      },
      order: { snapshotDate: 'DESC' },
    });

    const previousValue = previousSnapshot
      ? parseFloat(previousSnapshot.totalValueUsd)
      : totalValueUsd;

    const dailyChangeUsd = totalValueUsd - previousValue;
    const dailyChangePercent =
      previousValue > 0 ? (dailyChangeUsd / previousValue) * 100 : 0;

    return {
      totalValueUsd,
      totalAssets: holdings.length,
      totalWallets: wallets.length,
      dailyChangeUsd,
      dailyChangePercent,
      asOfMonth: new Date().toISOString().slice(0, 7),
    };
  }

  private async calculatePerformance(
    userId: string,
    timeFrame: PerformanceTimeFrame,
    currentValueUsd: number,
  ): Promise<PerformanceMetrics[]> {
    const frames: PerformanceTimeFrame[] =
      timeFrame === PerformanceTimeFrame.ALL_TIME
        ? [
            PerformanceTimeFrame.ONE_DAY,
            PerformanceTimeFrame.ONE_MONTH,
            PerformanceTimeFrame.ONE_YEAR,
            PerformanceTimeFrame.ALL_TIME,
          ]
        : [timeFrame];

    const results: PerformanceMetrics[] = [];

    for (const frame of frames) {
      const since = this.getTimeFrameStart(frame);
      const snapshot = await this.snapshotRepository.findOne({
        where: {
          userId,
          snapshotDate: MoreThanOrEqual(since),
        },
        order: { snapshotDate: 'ASC' },
      });

      const previousValue = snapshot
        ? parseFloat(snapshot.totalValueUsd)
        : currentValueUsd;

      const absoluteReturn = currentValueUsd - previousValue;
      const percentReturn =
        previousValue > 0 ? (absoluteReturn / previousValue) * 100 : 0;

      results.push({
        timeframe: frame,
        currentValueUsd,
        previousValueUsd: previousValue,
        absoluteReturn,
        percentReturn,
      });
    }

    return results;
  }

  private buildAllocation(
    holdings: AssetHolding[],
    totalValueUsd: number,
  ): AllocationBreakdown {
    const byAsset = holdings
      .map((h) => ({
        assetCode: h.assetCode,
        valueUsd: h.valueUsd,
        percent: totalValueUsd > 0 ? (h.valueUsd / totalValueUsd) * 100 : 0,
      }))
      .sort((a, b) => b.valueUsd - a.valueUsd);

    // Group by type: native vs tokenized
    const native = holdings
      .filter((h) => !h.assetIssuer)
      .reduce((s, h) => s + h.valueUsd, 0);
    const tokenized = totalValueUsd - native;

    const byType = [
      {
        type: 'Native (XLM)',
        valueUsd: native,
        percent: totalValueUsd > 0 ? (native / totalValueUsd) * 100 : 0,
      },
      {
        type: 'Tokenized Assets',
        valueUsd: tokenized,
        percent: totalValueUsd > 0 ? (tokenized / totalValueUsd) * 100 : 0,
      },
    ];

    return { byAsset, byType };
  }

  private async getAssetPrice(
    code: string,
    issuer: string | null,
  ): Promise<number> {
    const asset = await this.assetRepository.findOne({
      where: issuer ? { code, issuer } : { code, issuer: IsNull() },
    });

    if (!asset) return 0;

    // Derive price from totalSupply and market data if available
    const supply = parseFloat(asset.totalSupply ?? '0');
    if (supply > 0) {
      // Use a simple heuristic: for native XLM return 0.12 (testnet approx)
      if (asset.isNative) return 0.12;
      // For other assets, estimate from supply — in production this would
      // come from a price oracle or DEX order book
      return 0;
    }

    return asset.isNative ? 0.12 : 0;
  }

  private getTimeFrameStart(timeFrame: PerformanceTimeFrame): Date {
    const now = new Date();

    switch (timeFrame) {
      case PerformanceTimeFrame.ONE_DAY: {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        return d;
      }
      case PerformanceTimeFrame.ONE_MONTH: {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 1);
        return d;
      }
      case PerformanceTimeFrame.ONE_YEAR: {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() - 1);
        return d;
      }
      case PerformanceTimeFrame.ALL_TIME:
      default:
        return new Date(0);
    }
  }
}
