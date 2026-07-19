import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Horizon } from '@stellar/stellar-sdk';

export interface PooledConnection {
  server: Horizon.Server;
  inUse: boolean;
  lastUsed: Date;
  created: Date;
  usageCount: number;
  id: string;
}

export interface ConnectionPoolConfig {
  minConnections: number;
  maxConnections: number;
  idleTimeoutMs: number;
  connectionTtlMs: number;
}

@Injectable()
export class StellarConnectionPoolService {
  private readonly logger = new Logger(StellarConnectionPoolService.name);
  private connections: Map<string, PooledConnection> = new Map();
  private readonly horizonUrl: string;
  private readonly config: ConnectionPoolConfig;
  private cleanupInterval: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    this.horizonUrl = this.configService.get<string>('stellar.horizonUrl')!;
    this.config = {
      minConnections: this.configService.get<number>('stellar.poolMinConnections') ?? 2,
      maxConnections: this.configService.get<number>('stellar.poolMaxConnections') ?? 10,
      idleTimeoutMs: this.configService.get<number>('stellar.poolIdleTimeoutMs') ?? 30000,
      connectionTtlMs: this.configService.get<number>('stellar.poolConnectionTtlMs') ?? 3600000,
    };

    this.initializePool();
    this.startCleanupInterval();
  }

  private initializePool(): void {
    this.logger.log(`Initializing Stellar connection pool with min=${this.config.minConnections}, max=${this.config.maxConnections}`);
    for (let i = 0; i < this.config.minConnections; i++) {
      this.createConnection();
    }
    this.logger.log(`Connection pool initialized with ${this.connections.size} connections`);
  }

  private createConnection(): PooledConnection {
    const id = `stellar-conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const connection: PooledConnection = {
      server: new Horizon.Server(this.horizonUrl),
      inUse: false,
      lastUsed: new Date(),
      created: new Date(),
      usageCount: 0,
      id,
    };
    this.connections.set(id, connection);
    this.logger.debug(`Created new connection ${id}, total connections: ${this.connections.size}`);
    return connection;
  }

  async acquireConnection(): Promise<PooledConnection> {
    const availableConnection = Array.from(this.connections.values()).find(conn => !conn.inUse);
    
    if (availableConnection) {
      availableConnection.inUse = true;
      availableConnection.lastUsed = new Date();
      availableConnection.usageCount++;
      this.logger.debug(`Acquired existing connection ${availableConnection.id}`);
      return availableConnection;
    }

    if (this.connections.size < this.config.maxConnections) {
      const newConnection = this.createConnection();
      newConnection.inUse = true;
      newConnection.usageCount++;
      this.logger.debug(`Acquired new connection ${newConnection.id}, pool size: ${this.connections.size}`);
      return newConnection;
    }

    this.logger.warn('Pool exhausted, waiting for available connection...');
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const conn = Array.from(this.connections.values()).find(c => !c.inUse);
        if (conn) {
          clearInterval(checkInterval);
          conn.inUse = true;
          conn.lastUsed = new Date();
          conn.usageCount++;
          this.logger.debug(`Acquired waiting connection ${conn.id}`);
          resolve(conn);
        }
      }, 100);
    });
  }

  releaseConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.inUse = false;
      connection.lastUsed = new Date();
      this.logger.debug(`Released connection ${connectionId}`);
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 10000);
  }

  private cleanupIdleConnections(): void {
    const now = new Date();
    let removedCount = 0;

    for (const [id, connection] of this.connections.entries()) {
      if (!connection.inUse && this.connections.size > this.config.minConnections) {
        const idleTime = now.getTime() - connection.lastUsed.getTime();
        const age = now.getTime() - connection.created.getTime();
        
        if (idleTime > this.config.idleTimeoutMs || age > this.config.connectionTtlMs) {
          this.connections.delete(id);
          removedCount++;
          this.logger.debug(`Removed idle/expired connection ${id}`);
        }
      }
    }

    if (removedCount > 0) {
      this.logger.log(`Cleaned up ${removedCount} connections, current pool size: ${this.connections.size}`);
    }
  }

  getPoolStats(): { total: number; active: number; idle: number; config: ConnectionPoolConfig } {
    const connections = Array.from(this.connections.values());
    const active = connections.filter(c => c.inUse).length;
    return {
      total: connections.length,
      active,
      idle: connections.length - active,
      config: this.config,
    };
  }

  onDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.connections.clear();
  }
}