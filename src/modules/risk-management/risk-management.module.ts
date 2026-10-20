import { Module } from '@nestjs/common';
import { LiquidationRiskService } from './services/liquidation-risk.service';
import { PositionMonitorService } from './services/position-monitor.service';
import { RiskReportingService } from './services/risk-reporting.service';
import { StressTestingService } from './services/stress-testing.service';
import { ValueAtRiskService } from './services/value-at-risk.service';

/**
 * Risk management and position monitoring engine: real-time metrics
 * (Value-at-Risk, concentration, liquidity), liquidation-risk detection,
 * stress testing and risk reporting.
 */
@Module({
  providers: [
    ValueAtRiskService,
    PositionMonitorService,
    LiquidationRiskService,
    StressTestingService,
    RiskReportingService,
  ],
  exports: [
    ValueAtRiskService,
    PositionMonitorService,
    LiquidationRiskService,
    StressTestingService,
    RiskReportingService,
  ],
})
export class RiskManagementModule {}
