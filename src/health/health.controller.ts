import { Controller, Get, HttpStatus, Inject, Req, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import { hasAdminKey } from '../common/auth/admin-key.guard';
import { AppConfigService } from '../config/app-config.service';
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
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness of MongoDB, Redis and TigerBeetle',
    description:
      'Returns 200 or 503 with `healthy`. Per-dependency `checks` are included only for requests with a valid X-Admin-Key.',
  })
  @ApiSecurity('admin-key')
  async check(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const [mongo, redis, ledger] = await Promise.all([
      probe(() => this.mongo.db!.admin().ping()),
      probe(() => this.redis.ping()),
      probe(() => this.ledger.ping()),
    ]);
    const healthy = mongo === 'up' && redis === 'up' && ledger === 'up';
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    if (!hasAdminKey(req, this.config.get('ADMIN_API_KEY'))) {
      return { healthy };
    }
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
