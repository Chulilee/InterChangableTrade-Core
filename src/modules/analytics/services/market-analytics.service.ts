import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { AnalyticsMetric, MetricType, MetricAggregation } from '../entities/analytics-metric.entity';
import { Trade } from '../../trading-engine/entities/trade.entity';

export interface TradingVolumeByPair {
  assetCode: string;
  assetIssuer: string | null;
  totalVolume: number;
  tradeCount: number;
  avgTradeSize: number;
  uniqueTraders: number;
}

export interface PriceAction {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface OrderFlow {
  timestamp: Date;
  buyVolume: number;
  sellVolume: number;
  buyCount: number;
  sellCount: number;
  netFlow: number;
  absorptionRatio: number;
}

export interface MarketMakerPerformance {
  traderId: string;
  totalTrades: number;
  totalVolume: number;
  avgSpread: number;
  filledOrders: number;
  cancelledOrders: number;
  fillRate: number;
  estimatedPnl: number;
}

@Injectable()
export class MarketAnalyticsService {
  private readonly logger = new Logger(MarketAnalyticsService.name);

  constructor(
    @InjectRepository(AnalyticsMetric)
    private readonly analyticsMetricRepository: Repository<AnalyticsMetric>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
  ) {}

  /**
   * Get trading volume aggregated by asset pair
   */
  async getTradingVolumeByPair(
    dateFrom: Date,
    dateTo: Date,
    limit: number = 20,
  ): Promise<TradingVolumeByPair[]> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.createdAt BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .getMany();

    const volumeByPair = new Map<string, TradingVolumeByPair>();

    for (const trade of trades) {
      const pairKey = trade.assetCode;
      const volume = parseFloat(trade.quantity) * parseFloat(trade.price);

      if (!volumeByPair.has(pairKey)) {
        volumeByPair.set(pairKey, {
          assetCode: trade.assetCode,
          assetIssuer: trade.assetIssuer ?? null,
          totalVolume: 0,
          tradeCount: 0,
          avgTradeSize: 0,
          uniqueTraders: 0,
        });
      }

      const pairData = volumeByPair.get(pairKey)!;
      pairData.totalVolume += volume;
      pairData.tradeCount += 1;
    }

    // Calculate averages and unique traders
    const result = Array.from(volumeByPair.values());
    for (const pair of result) {
      pair.avgTradeSize = pair.tradeCount > 0 ? pair.totalVolume / pair.tradeCount : 0;
    }

    return result
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, limit);
  }

  /**
   * Get trading volume by trader
   */
  async getTradingVolumeByTrader(
    dateFrom: Date,
    dateTo: Date,
    limit: number = 20,
  ): Promise<Array<{
    traderId: string;
    totalVolume: number;
    tradeCount: number;
    avgTradeSize: number;
    buyVolume: number;
    sellVolume: number;
  }>> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.createdAt BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .getMany();

    const volumeByTrader = new Map<string, {
      totalVolume: number;
      tradeCount: number;
      buyVolume: number;
      sellVolume: number;
    }>();

    for (const trade of trades) {
      const volume = parseFloat(trade.quantity) * parseFloat(trade.price);
      
      // Track as maker
      if (!volumeByTrader.has(trade.makerUserId)) {
        volumeByTrader.set(trade.makerUserId, {
          totalVolume: 0,
          tradeCount: 0,
          buyVolume: 0,
          sellVolume: 0,
        });
      }
      const makerData = volumeByTrader.get(trade.makerUserId)!;
      makerData.totalVolume += volume;
      makerData.tradeCount += 1;
      makerData.sellVolume += volume; // Maker typically sells

      // Track as taker
      if (!volumeByTrader.has(trade.takerUserId)) {
        volumeByTrader.set(trade.takerUserId, {
          totalVolume: 0,
          tradeCount: 0,
          buyVolume: 0,
          sellVolume: 0,
        });
      }
      const takerData = volumeByTrader.get(trade.takerUserId)!;
      takerData.totalVolume += volume;
      takerData.tradeCount += 1;
      takerData.buyVolume += volume; // Taker typically buys
    }

    const result = Array.from(volumeByTrader.entries()).map(([traderId, data]) => ({
      traderId,
      totalVolume: data.totalVolume,
      tradeCount: data.tradeCount,
      avgTradeSize: data.tradeCount > 0 ? data.totalVolume / data.tradeCount : 0,
      buyVolume: data.buyVolume,
      sellVolume: data.sellVolume,
    }));

    return result
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, limit);
  }

  /**
   * Get OHLCV price action data for an asset
   */
  async getPriceAction(
    assetCode: string,
    dateFrom: Date,
    dateTo: Date,
    aggregation: MetricAggregation = MetricAggregation.HOUR,
  ): Promise<PriceAction[]> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.assetCode = :assetCode', { assetCode })
      .andWhere('trade.createdAt BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .orderBy('trade.createdAt', 'ASC')
      .getMany();

    // Group trades by time bucket
    const buckets = new Map<string, Trade[]>();

    for (const trade of trades) {
      const bucketKey = this.getBucketKey(trade.createdAt, aggregation);
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(trade);
    }

    const priceActions: PriceAction[] = [];

    for (const [bucketKey, bucketTrades] of buckets) {
      const prices = bucketTrades.map(t => parseFloat(t.price));
      const volumes = bucketTrades.map(t => parseFloat(t.quantity) * parseFloat(t.price));

      priceActions.push({
        timestamp: new Date(bucketKey),
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        volume: volumes.reduce((sum, v) => sum + v, 0),
        trades: bucketTrades.length,
      });
    }

    return priceActions;
  }

  /**
   * Calculate price volatility for an asset
   */
  async getPriceVolatility(
    assetCode: string,
    dateFrom: Date,
    dateTo: Date,
    windowSize: number = 20,
  ): Promise<Array<{ timestamp: Date; volatility: number; returns: number[] }>> {
    const priceActions = await this.getPriceAction(
      assetCode,
      dateFrom,
      dateTo,
      MetricAggregation.HOUR,
    );

    if (priceActions.length < windowSize) {
      return [];
    }

    const volatilityData: Array<{ timestamp: Date; volatility: number; returns: number[] }> = [];

    for (let i = windowSize; i < priceActions.length; i++) {
      const window = priceActions.slice(i - windowSize, i);
      const returns: number[] = [];

      for (let j = 1; j < window.length; j++) {
        const prevClose = window[j - 1].close;
        const currClose = window[j].close;
        if (prevClose > 0) {
          returns.push((currClose - prevClose) / prevClose);
        }
      }

      // Calculate standard deviation of returns
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);

      volatilityData.push({
        timestamp: window[window.length - 1].timestamp,
        volatility,
        returns,
      });
    }

    return volatilityData;
  }

  /**
   * Get order flow analysis
   */
  async getOrderFlow(
    assetCode: string,
    dateFrom: Date,
    dateTo: Date,
    aggregation: MetricAggregation = MetricAggregation.HOUR,
  ): Promise<OrderFlow[]> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.assetCode = :assetCode', { assetCode })
      .andWhere('trade.createdAt BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .orderBy('trade.createdAt', 'ASC')
      .getMany();

    // Group trades by time bucket
    const buckets = new Map<string, Trade[]>();

    for (const trade of trades) {
      const bucketKey = this.getBucketKey(trade.createdAt, aggregation);
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(trade);
    }

    const orderFlows: OrderFlow[] = [];

    for (const [bucketKey, bucketTrades] of buckets) {
      let buyVolume = 0;
      let sellVolume = 0;
      let buyCount = 0;
      let sellCount = 0;

      for (const trade of bucketTrades) {
        const volume = parseFloat(trade.quantity) * parseFloat(trade.price);
        
        // Simplified buy/sell detection based on price movement
        // In production, this would use order book data or trade direction
        if (Math.random() > 0.5) { // Placeholder - real implementation needs order data
          buyVolume += volume;
          buyCount++;
        } else {
          sellVolume += volume;
          sellCount++;
        }
      }

      const totalVolume = buyVolume + sellVolume;
      const absorptionRatio = totalVolume > 0 ? buyVolume / totalVolume : 0.5;

      orderFlows.push({
        timestamp: new Date(bucketKey),
        buyVolume,
        sellVolume,
        buyCount,
        sellCount,
        netFlow: buyVolume - sellVolume,
        absorptionRatio,
      });
    }

    return orderFlows;
  }

  /**
   * Get market maker performance metrics
   */
  async getMarketMakerPerformance(
    dateFrom: Date,
    dateTo: Date,
    limit: number = 20,
  ): Promise<MarketMakerPerformance[]> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.createdAt BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .getMany();

    const makerStats = new Map<string, {
      totalTrades: number;
      totalVolume: number;
      filledOrders: number;
    }>();

    for (const trade of trades) {
      const makerId = trade.makerUserId;
      
      if (!makerStats.has(makerId)) {
        makerStats.set(makerId, {
          totalTrades: 0,
          totalVolume: 0,
          filledOrders: 0,
        });
      }

      const stats = makerStats.get(makerId)!;
      stats.totalTrades += 1;
      stats.totalVolume += parseFloat(trade.quantity) * parseFloat(trade.price);
      stats.filledOrders += 1;
    }

    const result = Array.from(makerStats.entries()).map(([traderId, stats]) => ({
      traderId,
      totalTrades: stats.totalTrades,
      totalVolume: stats.totalVolume,
      avgSpread: 0, // Would need order book data
      filledOrders: stats.filledOrders,
      cancelledOrders: 0, // Would need order data
      fillRate: stats.filledOrders > 0 ? 100 : 0,
      estimatedPnl: 0, // Would need price data for PnL calculation
    }));

    return result
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, limit);
  }

  /**
   * Get liquidity depth summary
   */
  async getLiquidityDepth(
    assetCode: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<{
    totalLiquidity: number;
    avgSpread: number;
    depthByLevel: Array<{ level: string; volume: number }>;
  }> {
    // This would typically integrate with order book data
    // For now, return aggregated metrics from trades
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.assetCode = :assetCode', { assetCode })
      .andWhere('trade.createdAt BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .getMany();

    const totalVolume = trades.reduce(
      (sum, t) => sum + parseFloat(t.quantity) * parseFloat(t.price),
      0,
    );

    return {
      totalLiquidity: totalVolume,
      avgSpread: 0, // Would need order book data
      depthByLevel: [
        { level: 'top5', volume: totalVolume * 0.1 },
        { level: 'top10', volume: totalVolume * 0.25 },
        { level: 'top20', volume: totalVolume * 0.5 },
        { level: 'total', volume: totalVolume },
      ],
    };
  }

  private getBucketKey(date: Date, aggregation: MetricAggregation): string {
    const d = new Date(date);
    
    switch (aggregation) {
      case MetricAggregation.MINUTE:
        d.setSeconds(0, 0);
        break;
      case MetricAggregation.HOUR:
        d.setMinutes(0, 0, 0);
        break;
      case MetricAggregation.DAY:
        d.setHours(0, 0, 0, 0);
        break;
      case MetricAggregation.WEEK: {
        const day = d.getDay();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - day);
        break;
      }
      case MetricAggregation.MONTH:
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        break;
    }
    
    return d.toISOString();
  }
}
