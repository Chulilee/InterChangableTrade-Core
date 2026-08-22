
import { Injectable, Logger } from '@nestjs/common';
import { BlockchainEvent } from '../../blockchain-indexer/entities/blockchain-event.entity';
import { AlertRule, AlertCondition, LogicalOperator } from '../interfaces/alert-rule.interface';
import * as _ from 'lodash';

@Injectable()
export class RuleEvaluationService {
  private readonly logger = new Logger(RuleEvaluationService.name);
  private rules: Map<string, AlertRule> = new Map();

  constructor() {
    this.initializeRules();
  }

  private initializeRules() {
    // Liquidation Risk Alert - Critical
    this.registerRule({
      id: 'liquidation-risk-001',
      name: 'Position Liquidation Risk',
      description: 'Alert when a position is at risk of liquidation',
      enabled: true,
      conditions: {
        operator: LogicalOperator.AND,
        conditions: [
          { field: 'eventType', operator: 'equals', value: 'manage_offer' },
          { field: 'raw.margin_ratio', operator: 'less_than', value: 1.5 },
        ],
      },
      actions: [
        { type: 'push_notification', channels: ['websocket', 'mobile'], template: 'liquidation-warning', priority: 'critical' },
        { type: 'sms_alert', channels: ['sms'], template: 'liquidation-sms', priority: 'critical' },
      ],
      rateLimit: { maxPerHour: 10, maxPerDay: 50, cooldownPeriod: 300 },
      metadata: {
        severity: 'critical',
        category: 'risk',
        affectedUsers: 'portfolio_owners',
      },
      shouldTrigger: (event: BlockchainEvent) => {
        const rule = this.rules.get('liquidation-risk-001');
        return rule ? this.evaluateConditions(rule.conditions, event) : false;
      },
      getNotification: (event: BlockchainEvent) => ({
        title: '⚠️ LIQUIDATION RISK DETECTED',
        message: `Your position at risk: Margin ratio ${event.raw?.margin_ratio || 'N/A'}. Add collateral immediately.`,
        data: { transactionHash: event.transactionHash, amount: event.amount },
      }),
    });

    // Large Transfer Alert
    this.registerRule({
      id: 'large-transfer-001',
      name: 'Large Value Transfer',
      description: 'Alert for large cryptocurrency transfers',
      enabled: true,
      conditions: {
        operator: LogicalOperator.AND,
        conditions: [
          { field: 'eventType', operator: 'equals', value: 'payment' },
          { field: 'amount', operator: 'greater_than', value: 10000 },
        ],
      },
      actions: [
        { type: 'in_app', channels: ['websocket'], template: 'large-transfer', priority: 'high' },
        { type: 'email', channels: ['email'], template: 'large-transfer-html', priority: 'high' },
      ],
      rateLimit: { maxPerHour: 20, maxPerDay: 100, cooldownPeriod: 600 },
      metadata: {
        severity: 'high',
        category: 'transactions',
        affectedUsers: 'portfolio_owners',
      },
      shouldTrigger: (event: BlockchainEvent) => {
        const rule = this.rules.get('large-transfer-001');
        return rule ? this.evaluateConditions(rule.conditions, event) : false;
      },
      getNotification: (event: BlockchainEvent) => ({
        title: '💰 Large Transfer Detected',
        message: `${event.amount} ${event.assetCode} was transferred from your account.`,
        data: { destination: event.destinationAccount, amount: event.amount },
      }),
    });

    // Price Volatility Alert
    this.registerRule({
      id: 'price-volatility-001',
      name: 'Market Price Volatility',
      description: 'Alert on significant price movements',
      enabled: true,
      conditions: {
        operator: LogicalOperator.AND,
        conditions: [
          { field: 'eventType', operator: 'equals', value: 'price_update' },
          { field: 'raw.price_change_1h', operator: 'greater_than', value: 20 },
        ],
      },
      actions: [
        { type: 'push_notification', channels: ['websocket', 'mobile'], template: 'price-alert', priority: 'medium' },
      ],
      rateLimit: { maxPerHour: 30, maxPerDay: 150, cooldownPeriod: 900 },
      metadata: {
        severity: 'medium',
        category: 'market',
        affectedUsers: 'all',
      },
      shouldTrigger: (event: BlockchainEvent) => {
        const rule = this.rules.get('price-volatility-001');
        return rule ? this.evaluateConditions(rule.conditions, event) : false;
      },
      getNotification: (event: BlockchainEvent) => ({
        title: '📈 Significant Price Volatility Detected',
        message: `${event.assetCode} moved ${event.raw?.price_change_1h || 'N/A'}% in the last hour.`,
        data: { asset: event.assetCode, change: event.raw?.price_change_1h },
      }),
    });
  }

  registerRule(rule: AlertRule) {
    this.rules.set(rule.id, rule);
    this.logger.debug(`📋 Registered rule: ${rule.name} (${rule.id})`);
  }

  async evaluateRules(event: BlockchainEvent): Promise<AlertRule[]> {
    const matchingRules: AlertRule[] = [];
    
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      
      try {
        if (rule.shouldTrigger(event)) {
          matchingRules.push(rule);
        }
      } catch (error) {
        this.logger.error(`Failed to evaluate rule ${rule.id}:`, error);
      }
    }
    
    return matchingRules;
  }

  evaluateConditions(conditions: { operator: LogicalOperator; conditions: (AlertCondition | { operator: LogicalOperator; conditions: any[] })[] }, event: BlockchainEvent): boolean {
    const { operator, conditions: subConditions } = conditions;
    
    const results = subConditions.map((subCondition: any) => {
      if ('conditions' in subCondition) {
        return this.evaluateConditions(subCondition, event);
      }
      return this.evaluateSingleCondition(subCondition as AlertCondition, event);
    });

    switch (operator) {
      case LogicalOperator.AND:
        return results.every((r: boolean) => r);
      case LogicalOperator.OR:
        return results.some((r: boolean) => r);
      case LogicalOperator.NOT:
        return !results[0];
      default:
        return false;
    }
  }

  private evaluateSingleCondition(condition: AlertCondition, event: BlockchainEvent): boolean {
    const fieldValue = _.get(event, condition.field);
    
    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value;
      case 'not_equals':
        return fieldValue !== condition.value;
      case 'greater_than':
        return parseFloat(fieldValue) > parseFloat(condition.value);
      case 'less_than':
        return parseFloat(fieldValue) < parseFloat(condition.value);
      case 'contains':
        return String(fieldValue).includes(String(condition.value));
      case 'regex':
        return new RegExp(condition.value).test(String(fieldValue));
      default:
        return false;
    }
  }

  async getAffectedUsers(event: BlockchainEvent, rule: AlertRule): Promise<string[]> {
    switch (rule.metadata.affectedUsers) {
      case 'specific':
        return rule.metadata.userIds || [];
      case 'portfolio_owners':
        return this.getUsersWithAsset(event.assetCode, event.assetIssuer);
      case 'all':
      default:
        return this.getAllActiveUsers();
    }
  }

  private async getUsersWithAsset(assetCode: string, assetIssuer: string | undefined): Promise<string[]> {
    return [];
  }

  private async getAllActiveUsers(): Promise<string[]> {
    // Implementation would fetch all active users from user service
    return [];
  }
}