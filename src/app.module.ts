import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { LedgerModule } from './ledger/ledger.module';

@Module({
  imports: [AppConfigModule, DatabaseModule, LedgerModule, AccountsModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
