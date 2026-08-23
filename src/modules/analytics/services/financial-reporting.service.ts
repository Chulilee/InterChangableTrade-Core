import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { AnalyticsMetric, MetricType, MetricAggregation } from '../entities/analytics-metric.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';

export interface RevenueBreakdown {
  totalRevenue: number;
  feeRevenue: number;
  spreadRevenue: number;
  otherRevenue: number;
  revenueBySource: Array<{ source: string; amount: number; percentage: number }>;
  revenueByAsset: Array<{ assetCode: string; amount: number; percentage: number }>;
  revenueByPeriod: Array<{ period: string; amount: number; change: number }>;
}

export interface CostAnalysis {
  totalCosts: number;
  gasCosts: number;
  operationsCosts: number;
  infrastructureCosts: number;
  costByCategory: Array<{ category: string; amount: number; percentage: number }>;
  costTrend: Array<{ period: string; amount: number; change: number }>;
  costPerTransaction: number;
}

export interface ProfitabilityMetrics {
  grossProfit: number;
  netProfit: number;
  grossMargin: number;
  netMargin: number;
  profitabilityBySegment: Array<{
    segment: string;
    revenue: number;
    costs: number;
    profit: number;
    margin: number;
  }>;
  profitabilityByAsset: Array<{
    assetCode: string;
    revenue: number;
    costs: number;
    profit: number;
    margin: number;
  }>;
}

export interface YearOverYearPerformance {
  currentYear: {
    totalRevenue: number;
    totalCosts: number;
    netProfit: number;
    transactionCount: number;
    avgRevenuePerTransaction: number;
  };
  previousYear: {
    totalRevenue: number;
    totalCosts: number;
    netProfit: number;
    transactionCount: number;
    avgRevenuePerTransaction: number;
  };
  yoyChange: {
    revenueChange: number;
    costsChange: number;
    profitChange: number;
    transactionChange: number;
  };
  monthlyComparison: Array<{
    month: string;
    currentYear: number;
    previousYear: number;
    change: number;
  }>;
}

export interface ForecastData {
  period: string;
  actual: number | null;
  forecast: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
}

@Injectable()
export class FinancialReportingService {
  private readonly logger = new Logger(FinancialReportingService.name);

  constructor(
    @InjectRepository(AnalyticsMetric)
    private readonly analyticsMetricRepository: Repository<AnalyticsMetric>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
  ) {}

  /**
   * Get comprehensive revenue breakdown
   */
  async getRevenueBreakdown(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<RevenueBreakdown> {
    // Get fee revenue
    const feeMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.REVENUE_FEES,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    // Get spread revenue
    const spreadMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.REVENUE_SPREADS,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    // Get other revenue
    const otherMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.REVENUE,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    const feeRevenue = feeMetrics.reduce((sum, m) => sum + parseFloat(m.value), 0);
    const spreadRevenue = spreadMetrics.reduce((sum, m) => sum + parseFloat(m.value), 0);
    const otherRevenue = otherMetrics.reduce((sum, m) => sum + parseFloat(m.value), 0);
    const totalRevenue = feeRevenue + spreadRevenue + otherRevenue;

    // Revenue by source
    const revenueBySource = [
      { source: 'Trading Fees', amount: feeRevenue, percentage: totalRevenue > 0 ? (feeRevenue / totalRevenue) * 100 : 0 },
      { source: 'Spread Revenue', amount: spreadRevenue, percentage: totalRevenue > 0 ? (spreadRevenue / totalRevenue) * 100 : 0 },
      { source: 'Other', amount: otherRevenue, percentage: totalRevenue > 0 ? (otherRevenue / totalRevenue) * 100 : 0 },
    ];

    // Revenue by asset
    const revenueByAsset = this.groupMetricsByAsset([...feeMetrics, ...spreadMetrics, ...otherMetrics], totalRevenue);

    // Revenue by period (monthly)
    const revenueByPeriod = this.groupMetricsByPeriod([...feeMetrics, ...spreadMetrics, ...otherMetrics]);

    return {
      totalRevenue,
      feeRevenue,
      spreadRevenue,
      otherRevenue,
      revenueBySource,
      revenueByAsset,
      revenueByPeriod,
    };
  }

  /**
   * Get comprehensive cost analysis
   */
  async getCostAnalysis(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<CostAnalysis> {
    // Get gas costs
    const gasMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.COST_GAS,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    // Get operations costs
    const opsMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.COST_OPERATIONS,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    const gasCosts = gasMetrics.reduce((sum, m) => sum + parseFloat(m.value), 0);
    const operationsCosts = opsMetrics.reduce((sum, m) => sum + parseFloat(m.value), 0);
    const infrastructureCosts = 0; // Would come from infrastructure monitoring
    const totalCosts = gasCosts + operationsCosts + infrastructureCosts;

    // Cost by category
    const costByCategory = [
      { category: 'Gas/Fees', amount: gasCosts, percentage: totalCosts > 0 ? (gasCosts / totalCosts) * 100 : 0 },
      { category: 'Operations', amount: operationsCosts, percentage: totalCosts > 0 ? (operationsCosts / totalCosts) * 100 : 0 },
      { category: 'Infrastructure', amount: infrastructureCosts, percentage: totalCosts > 0 ? (infrastructureCosts / totalCosts) * 100 : 0 },
    ];

    // Cost trend (monthly)
    const costTrend = this.groupMetricsByPeriod([...gasMetrics, ...opsMetrics]);

    // Cost per transaction
    const transactionCount = await this.transactionRepository.count({
      where: { createdAt: Between(dateFrom, dateTo) },
    });
    const costPerTransaction = transactionCount > 0 ? totalCosts / transactionCount : 0;

    return {
      totalCosts,
      gasCosts,
      operationsCosts,
      infrastructureCosts,
      costByCategory,
      costTrend,
      costPerTransaction,
    };
  }

  /**
   * Get profitability metrics by segment
   */
  async getProfitabilityMetrics(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<ProfitabilityMetrics> {
    const revenue = await this.getRevenueBreakdown(dateFrom, dateTo);
    const costs = await this.getCostAnalysis(dateFrom, dateTo);

    const grossProfit = revenue.totalRevenue - costs.gasCosts;
    const netProfit = revenue.totalRevenue - costs.totalCosts;
    const grossMargin = revenue.totalRevenue > 0 ? (grossProfit / revenue.totalRevenue) * 100 : 0;
    const netMargin = revenue.totalRevenue > 0 ? (netProfit / revenue.totalRevenue) * 100 : 0;

    // Profitability by segment (would come from segment definitions)
    const profitabilityBySegment = [
      { segment: 'Retail Traders', revenue: revenue.totalRevenue * 0.6, costs: costs.totalCosts * 0.5, profit: 0, margin: 0 },
      { segment: 'Institutional', revenue: revenue.totalRevenue * 0.3, costs: costs.totalCosts * 0.3, profit: 0, margin: 0 },
      { segment: 'Market Makers', revenue: revenue.totalRevenue * 0.1, costs: costs.totalCosts * 0.2, profit: 0, margin: 0 },
    ];

    for (const segment of profitabilityBySegment) {
      segment.profit = segment.revenue - segment.costs;
      segment.margin = segment.revenue > 0 ? (segment.profit / segment.revenue) * 100 : 0;
    }

    // Profitability by asset
    const profitabilityByAsset = revenue.revenueByAsset.map(r => {
      const assetCosts = costs.totalCosts * (r.percentage / 100);
      return {
        assetCode: r.assetCode,
        revenue: r.amount,
        costs: assetCosts,
        profit: r.amount - assetCosts,
        margin: r.amount > 0 ? ((r.amount - assetCosts) / r.amount) * 100 : 0,
      };
    });

    return {
      grossProfit,
      netProfit,
      grossMargin,
      netMargin,
      profitabilityBySegment,
      profitabilityByAsset,
    };
  }

  /**
   * Get year-over-year performance comparison
   */
  async getYearOverYearPerformance(): Promise<YearOverYearPerformance> {
    const now = new Date();
    const currentYearStart = new Date(now.getFullYear(), 0, 1);
    const previousYearStart = new Date(now.getFullYear() - 1, 0, 1);
    const previousYearEnd = new Date(now.getFullYear() - 1, 11, 31);

    // Current year metrics
    const currentYearMetrics = await this.getYearMetrics(currentYearStart, now);
    const previousYearMetrics = await this.getYearMetrics(previousYearStart, previousYearEnd);

    // Calculate YoY changes
    const revenueChange = previousYearMetrics.totalRevenue > 0
      ? ((currentYearMetrics.totalRevenue - previousYearMetrics.totalRevenue) / previousYearMetrics.totalRevenue) * 100
      : 0;

    const costsChange = previousYearMetrics.totalCosts > 0
      ? ((currentYearMetrics.totalCosts - previousYearMetrics.totalCosts) / previousYearMetrics.totalCosts) * 100
      : 0;

    const profitChange = previousYearMetrics.netProfit > 0
      ? ((currentYearMetrics.netProfit - previousYearMetrics.netProfit) / previousYearMetrics.netProfit) * 100
      : 0;

    const transactionChange = previousYearMetrics.transactionCount > 0
      ? ((currentYearMetrics.transactionCount - previousYearMetrics.transactionCount) / previousYearMetrics.transactionCount) * 100
      : 0;

    // Monthly comparison
    const monthlyComparison = await this.getMonthlyComparison(now.getFullYear());

    return {
      currentYear: currentYearMetrics,
      previousYear: previousYearMetrics,
      yoyChange: {
        revenueChange,
        costsChange,
        profitChange,
        transactionChange,
      },
      monthlyComparison,
    };
  }

  /**
   * Get forecast modeling data
   */
  async getForecastData(
    metricType: MetricType,
    historicalMonths: number = 12,
    forecastMonths: number = 6,
  ): Promise<ForecastData[]> {
    const now = new Date();
    const historicalStart = new Date(now);
    historicalStart.setMonth(historicalStart.getMonth() - historicalMonths);

    // Get historical data
    const historicalMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType,
        timestamp: Between(historicalStart, now),
        aggregation: MetricAggregation.MONTH,
      },
      order: { timestamp: 'ASC' },
    });

    const historicalData = historicalMetrics.map(m => ({
      period: m.timestamp.toISOString().slice(0, 7),
      value: parseFloat(m.value),
    }));

    // Simple linear regression for forecasting
    const forecast = this.linearForecast(historicalData, forecastMonths);

    return forecast;
  }

  // ─── Private helper methods ─────────────────────────────────────────────

  private groupMetricsByAsset(metrics: AnalyticsMetric[], totalRevenue: number): Array<{ assetCode: string; amount: number; percentage: number }> {
    const byAsset = new Map<string, number>();

    for (const metric of metrics) {
      const assetCode = metric.assetCode ?? 'Unknown';
      const current = byAsset.get(assetCode) ?? 0;
      byAsset.set(assetCode, current + parseFloat(metric.value));
    }

    return Array.from(byAsset.entries())
      .map(([assetCode, amount]) => ({
        assetCode,
        amount,
        percentage: totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  private groupMetricsByPeriod(metrics: AnalyticsMetric[]): Array<{ period: string; amount: number; change: number }> {
    const byPeriod = new Map<string, number>();

    for (const metric of metrics) {
      const period = metric.timestamp.toISOString().slice(0, 7); // YYYY-MM
      const current = byPeriod.get(period) ?? 0;
      byPeriod.set(period, current + parseFloat(metric.value));
    }

    const sorted = Array.from(byPeriod.entries())
      .map(([period, amount]) => ({ period, amount, change: 0 }))
      .sort((a, b) => a.period.localeCompare(b.period));

    // Calculate changes
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1].amount;
      sorted[i].change = previous > 0 ? ((sorted[i].amount - previous) / previous) * 100 : 0;
    }

    return sorted;
  }

  private async getYearMetrics(startDate: Date, endDate: Date) {
    const revenueMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.REVENUE,
        timestamp: Between(startDate, endDate),
      },
    });

    const costMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.COST_GAS,
        timestamp: Between(startDate, endDate),
      },
    });

    const totalRevenue = revenueMetrics.reduce((sum, m) => sum + parseFloat(m.value), 0);
    const totalCosts = costMetrics.reduce((sum, m) => sum + parseFloat(m.value), 0);

    const transactionCount = await this.transactionRepository.count({
      where: { createdAt: Between(startDate, endDate) },
    });

    return {
      totalRevenue,
      totalCosts,
      netProfit: totalRevenue - totalCosts,
      transactionCount,
      avgRevenuePerTransaction: transactionCount > 0 ? totalRevenue / transactionCount : 0,
    };
  }

  private async getMonthlyComparison(year: number): Promise<Array<{ month: string; currentYear: number; previousYear: number; change: number }>> {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const result: Array<{ month: string; currentYear: number; previousYear: number; change: number }> = [];

    for (let i = 0; i < 12; i++) {
      const currentYearStart = new Date(year, i, 1);
      const currentYearEnd = new Date(year, i + 1, 0);
      const previousYearStart = new Date(year - 1, i, 1);
      const previousYearEnd = new Date(year - 1, i + 1, 0);

      const currentRevenue = await this.getMonthRevenue(currentYearStart, currentYearEnd);
      const previousRevenue = await this.getMonthRevenue(previousYearStart, previousYearEnd);

      const change = previousRevenue > 0
        ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
        : 0;

      result.push({
        month: months[i],
        currentYear: currentRevenue,
        previousYear: previousRevenue,
        change,
      });
    }

    return result;
  }

  private async getMonthRevenue(startDate: Date, endDate: Date): Promise<number> {
    const metrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.REVENUE,
        timestamp: Between(startDate, endDate),
      },
    });

    return metrics.reduce((sum, m) => sum + parseFloat(m.value), 0);
  }

  private linearForecast(
    historicalData: Array<{ period: string; value: number }>,
    forecastMonths: number,
  ): ForecastData[] {
    if (historicalData.length < 2) {
      return [];
    }

    // Simple linear regression
    const n = historicalData.length;
    const x = historicalData.map((_, i) => i);
    const y = historicalData.map(d => d.value);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((a, xi, i) => a + xi * y[i], 0);
    const sumX2 = x.reduce((a, xi) => a + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate standard error for confidence intervals
    const predictions = x.map(xi => slope * xi + intercept);
    const residuals = y.map((yi, i) => yi - predictions[i]);
    const sse = residuals.reduce((sum, r) => sum + r * r, 0);
    const standardError = Math.sqrt(sse / (n - 2));

    const result: ForecastData[] = [];

    // Historical data
    for (let i = 0; i < historicalData.length; i++) {
      result.push({
        period: historicalData[i].period,
        actual: historicalData[i].value,
        forecast: predictions[i],
        lowerBound: predictions[i] - 1.96 * standardError,
        upperBound: predictions[i] + 1.96 * standardError,
        confidence: 0.95,
      });
    }

    // Forecast
    const lastDate = new Date(historicalData[historicalData.length - 1].period + '-01');
    for (let i = 1; i <= forecastMonths; i++) {
      const forecastDate = new Date(lastDate);
      forecastDate.setMonth(forecastDate.getMonth() + i);
      
      const forecastValue = slope * (n + i - 1) + intercept;
      
      result.push({
        period: forecastDate.toISOString().slice(0, 7),
        actual: null,
        forecast: forecastValue,
        lowerBound: forecastValue - 1.96 * standardError * Math.sqrt(1 + 1/n + (n + i - 1 - sumX/n)**2 / (sumX2 - sumX*sumX/n)),
        upperBound: forecastValue + 1.96 * standardError * Math.sqrt(1 + 1/n + (n + i - 1 - sumX/n)**2 / (sumX2 - sumX*sumX/n)),
        confidence: 0.95,
      });
    }

    return result;
  }
}
