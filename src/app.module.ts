import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { AuditModule } from './audit/audit.module';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { FxModule } from './fx/fx.module';
import { JobsModule } from './jobs/jobs.module';
import { LedgerModule } from './ledger/ledger.module';
import { RedisModule } from './redis/redis.module';
import { RequestLogMiddleware } from './request-logs/request-log.middleware';
import { RequestLogsModule } from './request-logs/request-logs.module';
import { TransactionsModule } from './transactions/transactions.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    LedgerModule,
    JobsModule,
    RequestLogsModule,
    AuditModule,
    AccountsModule,
    FxModule,
    WalletsModule,
    TransactionsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, RequestLogMiddleware).forRoutes('*');
  }
}
