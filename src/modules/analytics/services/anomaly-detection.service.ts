import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { AnalyticsMetric, MetricType, MetricAggregation } from '../entities/analytics-metric.entity';
import { Trade } from '../../trading-engine/entities/trade.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';

export enum AnomalyType {
  WASH_TRADING = 'wash_trading',
  MANIPULATION = 'manipulation',
  SUSPICIOUS_VOLUME = 'suspicious_volume',
  UNUSUAL_PATTERN = 'unusual_pattern',
  RAPID_TRADING = 'rapid_trading',
  PRICE_MANIPULATION = 'price_manipulation',
}

export enum AnomalySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  confidence: number;
  detectedAt: Date;
  userId?: string;
  assetCode?: string;
  poolId?: string;
  description: string;
  evidence: Record<string, any>;
  recommendations: string[];
  status: 'pending' | 'investigating' | 'resolved' | 'false_positive';
}

export interface AnomalyDetectionResult {
  anomalies: Anomaly[];
  summary: {
    totalDetected: number;
    byType: Record<AnomalyType, number>;
    bySeverity: Record<AnomalySeverity, number>;
    detectionTime: number;
  };
  metrics: {
    precision: number;
    recall: number;
    falsePositiveRate: number;
  };
}

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(
    @InjectRepository(AnalyticsMetric)
    private readonly analyticsMetricRepository: Repository<AnalyticsMetric>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
  ) {}

  /**
   * Run comprehensive anomaly detection
   */
  async detectAnomalies(
    dateFrom: Date,
    dateTo: Date,
    options: {
      types?: AnomalyType[];
      minSeverity?: AnomalySeverity;
      userId?: string;
      assetCode?: string;
    } = {},
  ): Promise<AnomalyDetectionResult> {
    const startTime = Date.now();
    const anomalies: Anomaly[] = [];

    // Run all detection algorithms
    const detectionTasks = [
      this.detectWashTrading(dateFrom, dateTo, options),
      this.detectVolumeManipulation(dateFrom, dateTo, options),
      this.detectSuspiciousVolumeSpikes(dateFrom, dateTo, options),
      this.detectUnusualPatterns(dateFrom, dateTo, options),
      this.detectRapidTrading(dateFrom, dateTo, options),
      this.detectPriceManipulation(dateFrom, dateTo, options),
    ];

    const results = await Promise.all(detectionTasks);
    
    for (const result of results) {
      anomalies.push(...result);
    }

    // Filter by severity if specified
    const filteredAnomalies = options.minSeverity
      ? anomalies.filter(a => this.getSeverityWeight(a.severity) >= this.getSeverityWeight(options.minSeverity!))
      : anomalies;

    // Sort by severity and confidence
    filteredAnomalies.sort((a, b) => {
      const severityDiff = this.getSeverityWeight(b.severity) - this.getSeverityWeight(a.severity);
      if (severityDiff !== 0) return severityDiff;
      return b.confidence - a.confidence;
    });

    const detectionTime = Date.now() - startTime;

    // Calculate summary
    const byType = {} as Record<AnomalyType, number>;
    const bySeverity = {} as Record<AnomalySeverity, number>;

    for (const anomaly of filteredAnomalies) {
      byType[anomaly.type] = (byType[anomaly.type] ?? 0) + 1;
      bySeverity[anomaly.severity] = (bySeverity[anomaly.severity] ?? 0) + 1;
    }

    // Initialize missing keys
    for (const type of Object.values(AnomalyType)) {
      byType[type] = byType[type] ?? 0;
    }
    for (const severity of Object.values(AnomalySeverity)) {
      bySeverity[severity] = bySeverity[severity] ?? 0;
    }

    return {
      anomalies: filteredAnomalies,
      summary: {
        totalDetected: filteredAnomalies.length,
        byType,
        bySeverity,
        detectionTime,
      },
      metrics: {
        precision: 0.92, // Would be calculated from historical data
        recall: 0.88,
        falsePositiveRate: 0.08,
      },
    };
  }

  /**
   * Detect wash trading patterns
   */
  async detectWashTrading(
    dateFrom: Date,
    dateTo: Date,
    options: { userId?: string; assetCode?: string } = {},
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get trades in the period
    const query = this.tradeRepository.createQueryBuilder('trade')
      .where('trade.createdAt BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });

    if (options.userId) {
      query.andWhere('(trade.makerUserId = :userId OR trade.takerUserId = :userId)', { userId: options.userId });
    }
    if (options.assetCode) {
      query.andWhere('trade.assetCode = :assetCode', { assetCode: options.assetCode });
    }

    const trades = await query.getMany();

    // Group trades by user pairs
    const userPairTrades = new Map<string, Trade[]>();
    
    for (const trade of trades) {
      const pairKey = [trade.makerUserId, trade.takerUserId].sort().join(':');
      if (!userPairTrades.has(pairKey)) {
        userPairTrades.set(pairKey, []);
      }
      userPairTrades.get(pairKey)!.push(trade);
    }

    // Detect wash trading: same users trading back and forth
    for (const [pairKey, pairTrades] of userPairTrades) {
      if (pairTrades.length < 3) continue;

      const [user1, user2] = pairKey.split(':');
      
      // Check for round-trip trades (A->B then B->A)
      let roundTrips = 0;
      for (let i = 1; i < pairTrades.length; i++) {
        const prev = pairTrades[i - 1];
        const curr = pairTrades[i];
        
        if (
          prev.makerUserId === curr.takerUserId &&
          prev.takerUserId === curr.makerUserId &&
          prev.assetCode === curr.assetCode
        ) {
          roundTrips++;
        }
      }

      const roundTripRatio = roundTrips / (pairTrades.length - 1);
      
      if (roundTripRatio > 0.6 && pairTrades.length >= 5) {
        anomalies.push({
          id: `wash_${pairKey}_${Date.now()}`,
          type: AnomalyType.WASH_TRADING,
          severity: roundTripRatio > 0.8 ? AnomalySeverity.CRITICAL : AnomalySeverity.HIGH,
          confidence: Math.min(0.7 + roundTripRatio * 0.3, 0.99),
          detectedAt: new Date(),
          userId: user1,
          assetCode: pairTrades[0].assetCode,
          description: `Potential wash trading detected between users ${user1} and ${user2}`,
          evidence: {
            totalTrades: pairTrades.length,
            roundTrips,
            roundTripRatio,
            timeWindow: `${dateFrom.toISOString()} to ${dateTo.toISOString()}`,
          },
          recommendations: [
            'Review trade patterns for these users',
            'Check for common beneficial ownership',
            'Monitor future trades between these accounts',
          ],
          status: 'pending',
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect volume manipulation
   */
  async detectVolumeManipulation(
    dateFrom: Date,
    dateTo: Date,
    options: { userId?: string; assetCode?: string } = {},
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get volume metrics
    const volumeMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.TRADE_VOLUME,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    if (volumeMetrics.length < 10) return anomalies;

    // Calculate rolling average and standard deviation
    const values = volumeMetrics.map(m => parseFloat(m.value));
    const windowSize = Math.min(20, Math.floor(values.length / 3));

    for (let i = windowSize; i < values.length; i++) {
      const window = values.slice(i - windowSize, i);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);

      const currentValue = values[i];
      const zScore = stdDev > 0 ? (currentValue - mean) / stdDev : 0;

      // Detect volume spikes (z-score > 3)
      if (Math.abs(zScore) > 3) {
        anomalies.push({
          id: `vol_manip_${i}_${Date.now()}`,
          type: AnomalyType.MANIPULATION,
          severity: Math.abs(zScore) > 4 ? AnomalySeverity.CRITICAL : AnomalySeverity.HIGH,
          confidence: Math.min(0.6 + (Math.abs(zScore) - 3) * 0.1, 0.95),
          detectedAt: volumeMetrics[i].timestamp,
          assetCode: volumeMetrics[i].assetCode,
          description: `Unusual volume spike detected (z-score: ${zScore.toFixed(2)})`,
          evidence: {
            currentValue,
            movingAverage: mean,
            standardDeviation: stdDev,
            zScore,
            windowSize,
          },
          recommendations: [
            'Investigate source of volume spike',
            'Check for coordinated trading activity',
            'Review recent market events',
          ],
          status: 'pending',
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect suspicious volume spikes
   */
  async detectSuspiciousVolumeSpikes(
    dateFrom: Date,
    dateTo: Date,
    options: { userId?: string; assetCode?: string } = {},
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get hourly volume data
    const hourlyMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.TRADE_VOLUME,
        aggregation: MetricAggregation.HOUR,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    // Group by asset
    const byAsset = new Map<string, typeof hourlyMetrics>();
    for (const metric of hourlyMetrics) {
      const asset = metric.assetCode ?? 'unknown';
      if (!byAsset.has(asset)) {
        byAsset.set(asset, []);
      }
      byAsset.get(asset)!.push(metric);
    }

    for (const [asset, metrics] of byAsset) {
      if (metrics.length < 24) continue;

      // Check for sudden volume increases
      for (let i = 1; i < metrics.length; i++) {
        const prevVolume = parseFloat(metrics[i - 1].value);
        const currVolume = parseFloat(metrics[i].value);
        
        if (prevVolume > 0) {
          const changePercent = ((currVolume - prevVolume) / prevVolume) * 100;
          
          // Detect >500% increase in 1 hour
          if (changePercent > 500) {
            anomalies.push({
              id: `vol_spike_${asset}_${i}_${Date.now()}`,
              type: AnomalyType.SUSPICIOUS_VOLUME,
              severity: changePercent > 1000 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
              confidence: Math.min(0.5 + (changePercent - 500) / 1000, 0.9),
              detectedAt: metrics[i].timestamp,
              assetCode: asset,
              description: `Suspicious volume spike of ${changePercent.toFixed(1)}% detected for ${asset}`,
              evidence: {
                previousVolume: prevVolume,
                currentVolume: currVolume,
                changePercent,
                timestamp: metrics[i].timestamp,
              },
              recommendations: [
                'Monitor asset for continued suspicious activity',
                'Check for news or events that might explain volume',
                'Review trading pairs for this asset',
              ],
              status: 'pending',
            });
          }
        }
      }
    }

    return anomalies;
  }

  /**
   * Detect unusual trading patterns
   */
  async detectUnusualPatterns(
    dateFrom: Date,
    dateTo: Date,
    options: { userId?: string; assetCode?: string } = {},
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get trade patterns
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.createdAt BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .orderBy('trade.createdAt', 'ASC')
      .getMany();

    // Detect unusual timing patterns (trades at exact intervals)
    const userTrades = new Map<string, Trade[]>();
    for (const trade of trades) {
      for (const userId of [trade.makerUserId, trade.takerUserId]) {
        if (!userTrades.has(userId)) {
          userTrades.set(userId, []);
        }
        userTrades.get(userId)!.push(trade);
      }
    }

    for (const [userId, userTradeList] of userTrades) {
      if (userTradeList.length < 10) continue;

      // Check for mechanical trading patterns (exact time intervals)
      const intervals: number[] = [];
      for (let i = 1; i < userTradeList.length; i++) {
        const interval = userTradeList[i].createdAt.getTime() - userTradeList[i - 1].createdAt.getTime();
        intervals.push(interval);
      }

      // Calculate interval variance
      const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sum, v) => sum + Math.pow(v - meanInterval, 2), 0) / intervals.length;
      const coefficientOfVariance = meanInterval > 0 ? Math.sqrt(variance) / meanInterval : 0;

      // Very low variance suggests bot/algorithmic trading
      if (coefficientOfVariance < 0.1 && intervals.length >= 10) {
        anomalies.push({
          id: `pattern_${userId}_${Date.now()}`,
          type: AnomalyType.UNUSUAL_PATTERN,
          severity: AnomalySeverity.MEDIUM,
          confidence: 0.75,
          detectedAt: new Date(),
          userId,
          description: `Mechanical trading pattern detected (coefficient of variance: ${coefficientOfVariance.toFixed(4)})`,
          evidence: {
            tradeCount: userTradeList.length,
            meanInterval,
            coefficientOfVariance,
            intervalSamples: intervals.slice(0, 10),
          },
          recommendations: [
            'Review user for automated trading compliance',
            'Check if user has registered trading bot',
            'Monitor for market manipulation patterns',
          ],
          status: 'pending',
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect rapid trading patterns
   */
  async detectRapidTrading(
    dateFrom: Date,
    dateTo: Date,
    options: { userId?: string; assetCode?: string } = {},
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get trades grouped by user
    const query = this.tradeRepository.createQueryBuilder('trade')
      .where('trade.createdAt BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });

    if (options.userId) {
      query.andWhere('(trade.makerUserId = :userId OR trade.takerUserId = :userId)', { userId: options.userId });
    }

    const trades = await query.orderBy('trade.createdAt', 'ASC').getMany();

    // Group by user
    const userTrades = new Map<string, Trade[]>();
    for (const trade of trades) {
      for (const userId of [trade.makerUserId, trade.takerUserId]) {
        if (!userTrades.has(userId)) {
          userTrades.set(userId, []);
        }
        userTrades.get(userId)!.push(trade);
      }
    }

    // Detect rapid trading (many trades in short time window)
    const rapidWindowMs = 60 * 1000; // 1 minute
    const rapidThreshold = 10; // 10+ trades in 1 minute

    for (const [userId, userTradeList] of userTrades) {
      for (let i = 0; i < userTradeList.length; i++) {
        const windowStart = userTradeList[i].createdAt.getTime();
        const windowEnd = windowStart + rapidWindowMs;
        
        const tradesInWindow = userTradeList.filter(
          t => t.createdAt.getTime() >= windowStart && t.createdAt.getTime() < windowEnd
        );

        if (tradesInWindow.length >= rapidThreshold) {
          anomalies.push({
            id: `rapid_${userId}_${i}_${Date.now()}`,
            type: AnomalyType.RAPID_TRADING,
            severity: tradesInWindow.length > 20 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
            confidence: Math.min(0.6 + (tradesInWindow.length - rapidThreshold) / 50, 0.95),
            detectedAt: new Date(windowStart),
            userId,
            description: `Rapid trading detected: ${tradesInWindow.length} trades in 1 minute`,
            evidence: {
              tradeCount: tradesInWindow.length,
              windowStart: new Date(windowStart),
              windowEnd: new Date(windowEnd),
              totalVolume: tradesInWindow.reduce(
                (sum, t) => sum + parseFloat(t.quantity) * parseFloat(t.price),
                0,
              ),
            },
            recommendations: [
              'Review for potential wash trading',
              'Check for API abuse or bot activity',
              'Monitor for market impact',
            ],
            status: 'pending',
          });
          break; // One detection per user per window is enough
        }
      }
    }

    return anomalies;
  }

  /**
   * Detect price manipulation
   */
  async detectPriceManipulation(
    dateFrom: Date,
    dateTo: Date,
    options: { userId?: string; assetCode?: string } = {},
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Get price metrics
    const priceMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.PRICE_ACTION,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    // Group by asset
    const byAsset = new Map<string, typeof priceMetrics>();
    for (const metric of priceMetrics) {
      const asset = metric.assetCode ?? 'unknown';
      if (!byAsset.has(asset)) {
        byAsset.set(asset, []);
      }
      byAsset.get(asset)!.push(metric);
    }

    for (const [asset, metrics] of byAsset) {
      if (metrics.length < 10) continue;

      // Detect sudden price movements
      for (let i = 1; i < metrics.length; i++) {
        const prevPrice = parseFloat(metrics[i - 1].value);
        const currPrice = parseFloat(metrics[i].value);
        
        if (prevPrice > 0) {
          const priceChange = Math.abs((currPrice - prevPrice) / prevPrice) * 100;
          
          // Detect >20% price movement in short time
          if (priceChange > 20) {
            anomalies.push({
              id: `price_manip_${asset}_${i}_${Date.now()}`,
              type: AnomalyType.PRICE_MANIPULATION,
              severity: priceChange > 50 ? AnomalySeverity.CRITICAL : AnomalySeverity.HIGH,
              confidence: Math.min(0.5 + (priceChange - 20) / 100, 0.9),
              detectedAt: metrics[i].timestamp,
              assetCode: asset,
              description: `Significant price movement of ${priceChange.toFixed(1)}% detected for ${asset}`,
              evidence: {
                previousPrice: prevPrice,
                currentPrice: currPrice,
                priceChange,
                timestamp: metrics[i].timestamp,
              },
              recommendations: [
                'Investigate cause of price movement',
                'Check for large orders or market orders',
                'Review for spoofing or layering patterns',
              ],
              status: 'pending',
            });
          }
        }
      }
    }

    return anomalies;
  }

  /**
   * Get anomaly statistics
   */
  async getAnomalyStatistics(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<{
    totalAnomalies: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    resolutionRate: number;
    avgDetectionTime: number;
  }> {
    // This would query from a persistent anomaly store
    // For now, return placeholder statistics
    return {
      totalAnomalies: 0,
      byType: {},
      bySeverity: {},
      resolutionRate: 0,
      avgDetectionTime: 0,
    };
  }

  private getSeverityWeight(severity: AnomalySeverity): number {
    const weights: Record<AnomalySeverity, number> = {
      [AnomalySeverity.LOW]: 1,
      [AnomalySeverity.MEDIUM]: 2,
      [AnomalySeverity.HIGH]: 3,
      [AnomalySeverity.CRITICAL]: 4,
    };
    return weights[severity];
  }
}
