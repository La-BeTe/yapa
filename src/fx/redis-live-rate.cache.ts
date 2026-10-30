import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.constants';
import type { LiveRateCache, LiveSnapshot } from './fx.types';

const KEY = 'fx:live';

/** Shared cache of the latest live snapshot; expiry marks it stale and forces a refetch. */
@Injectable()
export class RedisLiveRateCache implements LiveRateCache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get(): Promise<LiveSnapshot | null> {
    const raw = await this.redis.get(KEY);
    return raw ? (JSON.parse(raw) as LiveSnapshot) : null;
  }

  async set(snapshot: LiveSnapshot, ttlSeconds: number): Promise<void> {
    await this.redis.set(KEY, JSON.stringify(snapshot), 'EX', ttlSeconds);
  }
}
