import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { JobsModule } from './jobs/jobs.module';
import { LedgerModule } from './ledger/ledger.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [AppConfigModule, DatabaseModule, RedisModule, LedgerModule, JobsModule, AccountsModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
