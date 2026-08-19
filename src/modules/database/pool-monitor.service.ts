import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface PoolMetrics {
  total: number;
  idle: number;
  waiting: number;
  active: number;
  utilizationPercent: number;
  timestamp: Date;
}

export interface PoolAlert {
  type: 'warning' | 'critical';
  message: string;
  metrics: PoolMetrics;
}

@Injectable()
export class PoolMonitorService {
  private readonly logger = new Logger(PoolMonitorService.name);
  private readonly metricsHistory: PoolMetrics[] = [];
  private readonly maxHistorySize = 100;

  constructor(private readonly dataSource: DataSource) {
    this.startMonitoring();
  }

  getCurrentMetrics(): PoolMetrics {
    const pool = (this.dataSource.driver.options.extra as any) || {};
    const total = pool.totalCount ?? 0;
    const idle = pool.idleCount ?? 0;
    const waiting = pool.waitingCount ?? 0;
    const active = total - idle;

    return {
      total,
      idle,
      waiting,
      active,
      utilizationPercent: total > 0 ? (active / total) * 100 : 0,
      timestamp: new Date(),
    };
  }

  async getDetailedMetrics(): Promise<PoolMetrics> {
    const pool = (this.dataSource.driver.options.extra as any) || {};

    try {
      const result = await this.dataSource.query(`
        SELECT
          count(*) as total,
          count(*) FILTER (WHERE state = 'idle') as idle,
          count(*) FILTER (WHERE state = 'active') as active,
          count(*) FILTER (WHERE wait_event_type IS NOT NULL) as waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);

      const row = result[0] || {};
      const total = parseInt(row.total, 10) || 0;
      const idle = parseInt(row.idle, 10) || 0;
      const active = parseInt(row.active, 10) || 0;
      const waiting = parseInt(row.waiting, 10) || 0;

      return {
        total,
        idle,
        active,
        waiting,
        utilizationPercent: total > 0 ? (active / total) * 100 : 0,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.warn('Failed to get detailed pool metrics', error);
      return this.getCurrentMetrics();
    }
  }

  recordMetrics(): void {
    const metrics = this.getCurrentMetrics();
    this.metricsHistory.push(metrics);

    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift();
    }

    const alerts = this.checkAlerts(metrics);
    for (const alert of alerts) {
      this.logger.warn(alert.message, JSON.stringify(alert.metrics));
    }
  }

  getMetricsHistory(): PoolMetrics[] {
    return [...this.metricsHistory];
  }

  getAverageUtilization(): number {
    if (this.metricsHistory.length === 0) return 0;
    const sum = this.metricsHistory.reduce(
      (acc, m) => acc + m.utilizationPercent,
      0,
    );
    return sum / this.metricsHistory.length;
  }

  getRecommendations(): string[] {
    const metrics = this.getCurrentMetrics();
    const recommendations: string[] = [];

    if (metrics.utilizationPercent > 80) {
      recommendations.push(
        `Pool utilization is ${metrics.utilizationPercent.toFixed(1)}%. Consider increasing pool max size.`,
      );
    }

    if (metrics.waiting > 0) {
      recommendations.push(
        `${metrics.waiting} connections waiting. Consider optimizing slow queries.`,
      );
    }

    if (metrics.total < 5) {
      recommendations.push(
        'Pool size is very small. Consider increasing pool size for better concurrency.',
      );
    }

    return recommendations;
  }

  private checkAlerts(metrics: PoolMetrics): PoolAlert[] {
    const alerts: PoolAlert[] = [];

    if (metrics.utilizationPercent > 90) {
      alerts.push({
        type: 'critical',
        message: `Critical: pool utilization at ${metrics.utilizationPercent.toFixed(1)}%`,
        metrics,
      });
    } else if (metrics.utilizationPercent > 75) {
      alerts.push({
        type: 'warning',
        message: `Warning: pool utilization at ${metrics.utilizationPercent.toFixed(1)}%`,
        metrics,
      });
    }

    if (metrics.waiting > 5) {
      alerts.push({
        type: 'critical',
        message: `Critical: ${metrics.waiting} connections waiting for pool`,
        metrics,
      });
    }

    return alerts;
  }

  private startMonitoring(): void {
    setInterval(() => this.recordMetrics(), 30000);

    this.logger.log('Pool monitoring started');
  }
}
