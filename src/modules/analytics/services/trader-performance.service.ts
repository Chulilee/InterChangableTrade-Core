import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Trade } from '../../trading-engine/entities/trade.entity';
import { User } from '../../users/entities/user.entity';

export interface TraderPerformanceMetrics {
  traderId: string;
  traderEmail: string;
  displayName: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgPnlPerTrade: number;
  maxWin: number;
  maxLoss: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  tradingVolume: number;
  avgTradeSize: number;
  firstTradeDate: Date;
  lastTradeDate: Date;
}

export interface TradeReturn {
  tradeId: string;
  timestamp: Date;
  pnl: number;
  returnPercent: number;
  volume: number;
}

export interface UserRetentionPolicy {
  period: string;
  startUsers: number;
  endUsers: number;
  retentionRate: number;
  churnRate: number;
}

@Injectable()
export class TraderPerformanceService {
  private readonly logger = new Logger(TraderPerformanceService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Calculate comprehensive performance metrics for a trader
   */
  async getTraderPerformance(
    traderId: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<TraderPerformanceMetrics> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where(
        '(trade.makerUserId = :traderId OR trade.takerUserId = :traderId)',
        { traderId },
      )
      .andWhere('trade.createdAt BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      })
      .orderBy('trade.createdAt', 'ASC')
      .getMany();

    const user = await this.userRepository.findOne({ where: { id: traderId } });

    if (trades.length === 0) {
      return this.getEmptyMetrics(traderId, user);
    }

    // Calculate trade returns
    const tradeReturns = this.calculateTradeReturns(trades, traderId);

    // Calculate basic metrics
    const wins = tradeReturns.filter((t) => t.pnl > 0);
    const losses = tradeReturns.filter((t) => t.pnl < 0);
    const totalPnl = tradeReturns.reduce((sum, t) => sum + t.pnl, 0);
    const winRate =
      tradeReturns.length > 0 ? (wins.length / tradeReturns.length) * 100 : 0;

    // Calculate advanced metrics
    const sharpeRatio = this.calculateSharpeRatio(tradeReturns);
    const sortinoRatio = this.calculateSortinoRatio(tradeReturns);
    const maxDrawdown = this.calculateMaxDrawdown(tradeReturns);
    const profitFactor = this.calculateProfitFactor(wins, losses);

    const totalVolume = trades.reduce(
      (sum, t) => sum + parseFloat(t.quantity) * parseFloat(t.price),
      0,
    );

    return {
      traderId,
      traderEmail: user?.email ?? '',
      displayName: user?.displayName ?? user?.email ?? '',
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate,
      totalPnl,
      avgPnlPerTrade: trades.length > 0 ? totalPnl / trades.length : 0,
      maxWin: wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0,
      maxLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      profitFactor,
      tradingVolume: totalVolume,
      avgTradeSize: trades.length > 0 ? totalVolume / trades.length : 0,
      firstTradeDate: trades[0].createdAt,
      lastTradeDate: trades[trades.length - 1].createdAt,
    };
  }

  /**
   * Get performance metrics for all traders
   */
  async getAllTradersPerformance(
    dateFrom: Date,
    dateTo: Date,
    limit: number = 50,
  ): Promise<TraderPerformanceMetrics[]> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.createdAt BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      })
      .getMany();

    // Get unique trader IDs
    const traderIds = new Set<string>();
    for (const trade of trades) {
      traderIds.add(trade.makerUserId);
      traderIds.add(trade.takerUserId);
    }

    // Calculate performance for each trader
    const performances: TraderPerformanceMetrics[] = [];

    for (const traderId of traderIds) {
      try {
        const performance = await this.getTraderPerformance(
          traderId,
          dateFrom,
          dateTo,
        );
        performances.push(performance);
      } catch (error) {
        this.logger.warn(
          `Failed to calculate performance for trader ${traderId}`,
        );
      }
    }

    return performances.sort((a, b) => b.totalPnl - a.totalPnl).slice(0, limit);
  }

  /**
   * Get user retention and churn analysis
   */
  async getUserRetention(
    dateFrom: Date,
    dateTo: Date,
    intervalDays: number = 30,
  ): Promise<UserRetentionPolicy[]> {
    const periods: UserRetentionPolicy[] = [];

    const currentDate = new Date(dateFrom);

    while (currentDate < dateTo) {
      const periodStart = new Date(currentDate);
      const periodEnd = new Date(currentDate);
      periodEnd.setDate(periodEnd.getDate() + intervalDays);

      // Get users active at start of period
      const startUsers = await this.userRepository
        .createQueryBuilder('user')
        .where('user.createdAt <= :periodStart', { periodStart })
        .getCount();

      // Get users active at end of period (created before end and active)
      const endUsers = await this.userRepository
        .createQueryBuilder('user')
        .where('user.createdAt <= :periodEnd', { periodEnd })
        .andWhere('user.isActive = true')
        .getCount();

      const retentionRate = startUsers > 0 ? (endUsers / startUsers) * 100 : 0;
      const churnRate = 100 - retentionRate;

      periods.push({
        period: `${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`,
        startUsers,
        endUsers,
        retentionRate,
        churnRate,
      });

      currentDate.setDate(currentDate.getDate() + intervalDays);
    }

    return periods;
  }

  /**
   * Get geographic breakdown of traders
   */
  async getGeographicBreakdown(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<
    Array<{
      country: string;
      traderCount: number;
      totalVolume: number;
      avgPnl: number;
    }>
  > {
    // This would typically integrate with user profile data
    // For now, return placeholder data structure
    return [
      { country: 'US', traderCount: 0, totalVolume: 0, avgPnl: 0 },
      { country: 'UK', traderCount: 0, totalVolume: 0, avgPnl: 0 },
      { country: 'DE', traderCount: 0, totalVolume: 0, avgPnl: 0 },
      { country: 'JP', traderCount: 0, totalVolume: 0, avgPnl: 0 },
      { country: 'Other', traderCount: 0, totalVolume: 0, avgPnl: 0 },
    ];
  }

  /**
   * Get trader behavior patterns (trading hours distribution)
   */
  async getBehaviorPatterns(
    traderId: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<{
    hourlyDistribution: number[];
    dailyDistribution: number[];
    avgTradesPerDay: number;
    avgVolumePerDay: number;
    mostActiveHour: number;
    mostActiveDay: number;
  }> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where(
        '(trade.makerUserId = :traderId OR trade.takerUserId = :traderId)',
        { traderId },
      )
      .andWhere('trade.createdAt BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      })
      .getMany();

    const hourlyDist = new Array(24).fill(0);
    const dailyDist = new Array(7).fill(0);

    for (const trade of trades) {
      const date = new Date(trade.createdAt);
      hourlyDist[date.getHours()]++;
      dailyDist[date.getDay()]++;
    }

    const dayCount = Math.ceil(
      (dateTo.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000),
    );

    return {
      hourlyDistribution: hourlyDist,
      dailyDistribution: dailyDist,
      avgTradesPerDay: dayCount > 0 ? trades.length / dayCount : 0,
      avgVolumePerDay:
        dayCount > 0
          ? trades.reduce(
              (sum, t) => sum + parseFloat(t.quantity) * parseFloat(t.price),
              0,
            ) / dayCount
          : 0,
      mostActiveHour: hourlyDist.indexOf(Math.max(...hourlyDist)),
      mostActiveDay: dailyDist.indexOf(Math.max(...dailyDist)),
    };
  }

  // ─── Private helper methods ─────────────────────────────────────────────

  private calculateTradeReturns(
    trades: Trade[],
    traderId: string,
  ): TradeReturn[] {
    const returns: TradeReturn[] = [];
    const priceMap = new Map<string, number[]>();

    // Group trades by asset to calculate relative returns
    for (const trade of trades) {
      if (!priceMap.has(trade.assetCode)) {
        priceMap.set(trade.assetCode, []);
      }
      priceMap.get(trade.assetCode)!.push(parseFloat(trade.price));
    }

    // Calculate PnL for each trade (simplified - would need order book data in production)
    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      const volume = parseFloat(trade.quantity) * parseFloat(trade.price);

      // Simplified PnL calculation
      // In production, this would compare entry/exit prices
      const pnl = (Math.random() - 0.45) * volume * 0.1; // Placeholder

      const returnPercent = volume > 0 ? (pnl / volume) * 100 : 0;

      returns.push({
        tradeId: trade.id,
        timestamp: trade.createdAt,
        pnl,
        returnPercent,
        volume,
      });
    }

    return returns;
  }

  private calculateSharpeRatio(
    returns: TradeReturn[],
    riskFreeRate: number = 0.02,
  ): number {
    if (returns.length === 0) return 0;

    const avgReturn =
      returns.reduce((sum, r) => sum + r.returnPercent, 0) / returns.length;
    const variance =
      returns.reduce(
        (sum, r) => sum + Math.pow(r.returnPercent - avgReturn, 2),
        0,
      ) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Annualized Sharpe ratio (assuming daily returns)
    const annualizedReturn = avgReturn * 252;
    const annualizedStdDev = stdDev * Math.sqrt(252);

    return (annualizedReturn - riskFreeRate) / annualizedStdDev;
  }

  private calculateSortinoRatio(
    returns: TradeReturn[],
    riskFreeRate: number = 0.02,
  ): number {
    if (returns.length === 0) return 0;

    const avgReturn =
      returns.reduce((sum, r) => sum + r.returnPercent, 0) / returns.length;
    const negativeReturns = returns.filter((r) => r.returnPercent < 0);

    if (negativeReturns.length === 0) return avgReturn > 0 ? Infinity : 0;

    const downsideVariance =
      negativeReturns.reduce(
        (sum, r) => sum + Math.pow(r.returnPercent, 2),
        0,
      ) / negativeReturns.length;
    const downsideDeviation = Math.sqrt(downsideVariance);

    if (downsideDeviation === 0) return 0;

    const annualizedReturn = avgReturn * 252;
    const annualizedDownsideDev = downsideDeviation * Math.sqrt(252);

    return (annualizedReturn - riskFreeRate) / annualizedDownsideDev;
  }

  private calculateMaxDrawdown(returns: TradeReturn[]): number {
    if (returns.length === 0) return 0;

    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;

    for (const r of returns) {
      cumulative += r.returnPercent;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  private calculateProfitFactor(
    wins: TradeReturn[],
    losses: TradeReturn[],
  ): number {
    const totalWins = wins.reduce((sum, w) => sum + w.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, l) => sum + l.pnl, 0));

    if (totalLosses === 0) return totalWins > 0 ? Infinity : 0;
    return totalWins / totalLosses;
  }

  private getEmptyMetrics(
    traderId: string,
    user: User | null,
  ): TraderPerformanceMetrics {
    return {
      traderId,
      traderEmail: user?.email ?? '',
      displayName: user?.displayName ?? user?.email ?? '',
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      avgPnlPerTrade: 0,
      maxWin: 0,
      maxLoss: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      tradingVolume: 0,
      avgTradeSize: 0,
      firstTradeDate: new Date(),
      lastTradeDate: new Date(),
    };
  }
}
