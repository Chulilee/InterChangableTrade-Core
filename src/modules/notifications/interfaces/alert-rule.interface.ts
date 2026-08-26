import { BlockchainEvent } from '../../blockchain-indexer/entities/blockchain-event.entity';

export enum LogicalOperator {
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
}

export interface AlertCondition {
  field: string;
  operator:
    | 'equals'
    | 'not_equals'
    | 'greater_than'
    | 'less_than'
    | 'contains'
    | 'regex';
  value: any;
}

export interface AlertAction {
  type: string;
  channels: string[];
  template: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface RateLimitConfig {
  maxPerHour: number;
  maxPerDay: number;
  cooldownPeriod: number; // seconds
}

export interface AlertMetadata {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  affectedUsers: 'all' | 'specific' | 'portfolio_owners';
  userIds?: string[];
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: {
    operator: LogicalOperator;
    conditions: (
      | AlertCondition
      | { operator: LogicalOperator; conditions: AlertCondition[] }
    )[];
  };
  actions: AlertAction[];
  rateLimit: RateLimitConfig;
  metadata: AlertMetadata;

  // Evaluation methods
  shouldTrigger(event: BlockchainEvent): boolean;
  getNotification(event: BlockchainEvent): {
    title: string;
    message: string;
    data?: any;
  };
}
