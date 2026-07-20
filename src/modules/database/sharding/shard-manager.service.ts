import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ShardStrategy = 'hash' | 'range' | 'directory';

export interface ShardConfig {
  strategy: ShardStrategy;
  shardCount: number;
  shards: Array<{
    id: number;
    host: string;
    port: number;
    database: string;
  }>;
}

export interface ShardKey {
  table: string;
  column: string;
  strategy: ShardStrategy;
}

@Injectable()
export class ShardManagerService {
  private readonly logger = new Logger(ShardManagerService.name);
  private readonly config: ShardConfig;
  private readonly shardKeys: Map<string, ShardKey> = new Map();

  constructor(private readonly configService: ConfigService) {
    const shardingStrategy = (this.configService.get('database.shardingStrategy') as ShardStrategy) || 'hash';
    const shardCount = this.configService.get('database.shardCount') || 1;

    this.config = {
      strategy: shardingStrategy,
      shardCount,
      shards: this.buildShardConfig(),
    };
  }

  getShard(key: string | number): number {
    if (this.config.shardCount <= 1) {
      return 0;
    }

    switch (this.config.strategy) {
      case 'hash':
        return this.hashShard(key);
      case 'range':
        return this.rangeShard(key);
      case 'directory':
        return this.directoryShard(key);
      default:
        return this.hashShard(key);
    }
  }

  getShardConnection(shardId: number): { host: string; port: number; database: string } {
    const shard = this.config.shards.find((s) => s.id === shardId);
    if (!shard) {
      throw new Error(`Shard ${shardId} not found`);
    }
    return {
      host: shard.host,
      port: shard.port,
      database: shard.database,
    };
  }

  registerShardKey(table: string, column: string, strategy: ShardStrategy = 'hash'): void {
    this.shardKeys.set(`${table}.${column}`, {
      table,
      column,
      strategy,
    });
    this.logger.log(`Registered shard key: ${table}.${column} (${strategy})`);
  }

  getShardKey(table: string, column: string): ShardKey | undefined {
    return this.shardKeys.get(`${table}.${column}`);
  }

  getAllShardKeys(): ShardKey[] {
    return Array.from(this.shardKeys.values());
  }

  getConfig(): ShardConfig {
    return { ...this.config, shards: [...this.config.shards] };
  }

  private hashShard(key: string | number): number {
    const str = String(key);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % this.config.shardCount;
  }

  private rangeShard(key: string | number): number {
    const num = typeof key === 'number' ? key : parseInt(String(key), 10);
    const shardSize = Number.MAX_SAFE_INTEGER / this.config.shardCount;
    return Math.min(Math.floor(num / shardSize), this.config.shardCount - 1);
  }

  private directoryShard(key: string | number): number {
    const str = String(key);
    return this.hashShard(str) % this.config.shardCount;
  }

  private buildShardConfig(): Array<{ id: number; host: string; port: number; database: string }> {
    const shards: Array<{ id: number; host: string; port: number; database: string }> = [];
    const dbConfig = this.configService.get('database') || {};

    for (let i = 0; i < this.config.shardCount; i++) {
      shards.push({
        id: i,
        host: (dbConfig as any).host || 'localhost',
        port: ((dbConfig as any).port || 5432) + i,
        database: `${(dbConfig as any).name || 'interchangabletrade'}_shard_${i}`,
      });
    }

    return shards;
  }
}
