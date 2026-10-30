import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import { LedgerService } from '../ledger/ledger.service';
import { REDIS } from '../redis/redis.constants';

const CHECK_TIMEOUT_MS = 2000;

type CheckResult = 'up' | 'down';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly ledger: LedgerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness of MongoDB, Redis and TigerBeetle' })
  async check(@Res({ passthrough: true }) res: Response) {
    const [mongo, redis, ledger] = await Promise.all([
      probe(() => this.mongo.db!.admin().ping()),
      probe(() => this.redis.ping()),
      probe(() => this.ledger.ping()),
    ]);
    const healthy = mongo === 'up' && redis === 'up' && ledger === 'up';
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { healthy, checks: { mongo, redis, ledger } };
  }
}

/** The TigerBeetle client retries forever when the cluster is unreachable, so bound every probe. */
async function probe(check: () => Promise<unknown>): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
