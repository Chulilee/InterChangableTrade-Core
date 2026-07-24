# Analytics & Reporting Module

A comprehensive analytics and reporting module for the InterChangableTrade platform that provides insights into trading activity, user behavior, system performance, and blockchain metrics.

## Features

### 📊 Trade Analytics
- Real-time trade volume tracking
- Trade frequency and settlement time metrics
- Asset-specific analytics
- Historical trend analysis with multi-level aggregation (minute, hour, day, week, month)

### 👥 User Activity Tracking & Segmentation
- User segmentation with auto and manual segment types
- Behavior-based user filtering (trading volume, frequency, last login)
- Active user tracking
- New user registration metrics

### 📈 System Performance & Health
- System latency monitoring
- Error rate tracking
- Automated health metrics collection
- Dashboard with real-time summary

### 💰 Revenue & Fee Analytics
- Transaction fee tracking
- Revenue aggregation by time periods
- Asset-specific revenue metrics

### 📑 Custom Report Generation
- Multiple report types: trade summary, user analytics, revenue report, system health, blockchain metrics
- Asynchronous report processing
- Support for custom filters and dimensions

### 📁 Data Export Capabilities
- CSV export
- JSON export
- File download endpoints
- Automatic file cleanup

### ⚡ Real-time Dashboards
- Live dashboard summary
- Time series data visualization support
- Period-over-period change calculations
- Widget-ready data formats

### 📅 Historical Analysis
- 2+ year data retention policy
- Automated data cleanup
- Monthly, weekly, and daily aggregations
- Trend analysis APIs

## API Endpoints

### Metrics & Analytics
- `GET /analytics/metrics` - Query metrics with filtering
- `GET /analytics/timeseries/:metricType` - Get time series data
- `GET /analytics/dashboard` - Get dashboard summary
- `GET /analytics/trends/:metricType` - Get historical trends

### Reports
- `POST /analytics/reports` - Generate new report
- `GET /analytics/reports` - Get user's reports
- `GET /analytics/reports/:id` - Get report details
- `GET /analytics/reports/:id/download` - Download report
- `DELETE /analytics/reports/:id` - Delete report

### User Segments
- `POST /analytics/segments` - Create user segment (admin/analyst only)
- `GET /analytics/segments` - Get all segments
- `GET /analytics/segments/:id` - Get segment details
- `PUT /analytics/segments/:id` - Update segment (admin/analyst only)
- `DELETE /analytics/segments/:id` - Delete segment (admin only)
- `POST /analytics/segments/:id/recalculate` - Recalculate segment users
- `POST /analytics/segments/:segmentId/users/:userId` - Add user to segment
- `DELETE /analytics/segments/:segmentId/users/:userId` - Remove user from segment

### Manual Metrics Calculation
- `POST /analytics/calculate/trade-metrics` - Trigger trade metrics calculation
- `POST /analytics/calculate/user-metrics` - Trigger user metrics calculation
- `POST /analytics/calculate/revenue-metrics` - Trigger revenue metrics calculation

## Example Report Queries

### 1. Daily Trade Summary Report (CSV)
```typescript
POST /analytics/reports
{
  "name": "Daily Trade Summary - July 2024",
  "reportType": "trade_summary",
  "format": "csv",
  "dateFrom": "2024-07-01T00:00:00Z",
  "dateTo": "2024-07-31T23:59:59Z",
  "filters": {
    "settled": true,
    "assetCode": "USDC"
  }
}
```

### 2. User Analytics Report (JSON)
```typescript
POST /analytics/reports
{
  "name": "Monthly Active Users Analysis",
  "reportType": "user_analytics",
  "format": "json",
  "dateFrom": "2024-07-01T00:00:00Z",
  "dateTo": "2024-07-31T23:59:59Z",
  "filters": {
    "isActive": true
  }
}
```

### 3. Revenue Report (Custom)
```typescript
POST /analytics/reports
{
  "name": "Q2 2024 Revenue Report",
  "reportType": "custom",
  "format": "json",
  "dateFrom": "2024-04-01T00:00:00Z",
  "dateTo": "2024-06-30T23:59:59Z",
  "metrics": ["transaction_fee", "revenue"],
  "dimensions": ["assetCode", "month"]
}
```

## Example User Segment Creation

### Auto-Segment: High-Volume Traders
```typescript
POST /analytics/segments
{
  "name": "High-Volume Traders",
  "description": "Users who have traded over $100k in volume",
  "segmentType": "auto",
  "filterCriteria": {
    "minVolume": 100000,
    "lastLoginDays": 30,
    "isActive": true
  }
}
```

### Manual Segment: Beta Testers
```typescript
POST /analytics/segments
{
  "name": "Beta Testers",
  "description": "Initial beta testing group",
  "segmentType": "manual",
  "userIds": [
    "a1b2c3d4-...",
    "e5f6g7h8-..."
  ]
}
```

## Example Dashboard Query
```typescript
GET /analytics/dashboard
```
Response includes:
- Current day metrics vs previous day
- Percentage changes for all key metrics
- Real-time timestamp
- Widget-ready format for frontend consumption

## Scheduled Tasks

The module automatically runs these background tasks:

- **Every minute**: Trade metrics calculation
- **Every hour**: User metrics calculation
- **Every hour**: Revenue metrics calculation
- **Twice daily**: Auto-segment user recalculation
- **Weekly**: Old data cleanup (maintains 2-year retention)

## Performance Metrics

- **Dashboard loads**: < 2 seconds
- **Analytics queries**: < 5 seconds
- **Custom report generation**: < 10 seconds
- **Data retention**: 2+ years
- **Unit test coverage**: Target > 85%

## Database Entities

### analytics_metrics
Stores all aggregated metrics with timestamp-based indexing for fast querying.

### saved_reports
Stores report metadata and file locations, supports scheduled reports.

### user_segments
Stores user segment definitions and member lists for both auto and manual segments.

## Integration

To use the metrics collector from other modules:

```typescript
import { MetricsCollectorService } from '@/modules/analytics/services/metrics-collector.service';
import { MetricType } from '@/modules/analytics/entities/analytics-metric.entity';

// Inject and record custom metrics
await this.metricsCollector.recordMetric(
  MetricType.SYSTEM_LATENCY,
  responseTime.toString(),
  new Date(),
  { endpoint: 'api/trades' },
  undefined,
  undefined,
  userId,
  'api-gateway'
);
```