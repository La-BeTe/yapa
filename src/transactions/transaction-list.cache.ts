import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.constants';

export const TRANSACTION_LIST_CACHE = Symbol('TRANSACTION_LIST_CACHE');

/**
 * Versioned cache for wallet history pages. Each wallet has a version counter that is
 * bumped whenever one of its transactions is finalized; page keys embed the version, so
 * invalidation is a single INCR and stale pages simply age out.
 */
export interface TransactionListCache {
  version(walletId: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  bump(walletIds: string[]): Promise<void>;
}

@Injectable()
export class RedisTransactionListCache implements TransactionListCache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async version(walletId: string): Promise<number> {
    return Number((await this.redis.get(versionKey(walletId))) ?? 0);
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async bump(walletIds: string[]): Promise<void> {
    const pipeline = this.redis.multi();
    for (const walletId of new Set(walletIds)) {
      pipeline.incr(versionKey(walletId));
    }
    await pipeline.exec();
  }
}

function versionKey(walletId: string): string {
  return `tx:list:version:${walletId}`;
}
