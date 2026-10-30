import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsModule } from '../accounts/accounts.module';
import { WalletsModule } from '../wallets/wallets.module';
import { MongoTransactionRepository } from './mongo-transaction.repository';
import { TRANSACTION_FINALIZED_HOOKS, TransactionExecutor } from './transaction.executor';
import { Transaction, TransactionSchema } from './transaction.schema';
import { TRANSACTION_REPOSITORY } from './transaction.types';
import { TransactionsController } from './transactions.controller';
import { TransactionHistoryService } from './transaction-history.service';
import { RedisTransactionListCache, TRANSACTION_LIST_CACHE } from './transaction-list.cache';
import { TransactionsService } from './transactions.service';
import { WalletTransactionsController } from './wallet-transactions.controller';

@Module({
  imports: [
    AccountsModule,
    WalletsModule,
    MongooseModule.forFeature([{ name: Transaction.name, schema: TransactionSchema }]),
  ],
  controllers: [TransactionsController, WalletTransactionsController],
  providers: [
    TransactionsService,
    TransactionExecutor,
    { provide: TRANSACTION_REPOSITORY, useClass: MongoTransactionRepository },
    TransactionHistoryService,
    { provide: TRANSACTION_LIST_CACHE, useClass: RedisTransactionListCache },
    {
      provide: TRANSACTION_FINALIZED_HOOKS,
      inject: [TransactionHistoryService],
      useFactory: (history: TransactionHistoryService) => [history],
    },
  ],
  exports: [TransactionsService, TransactionExecutor, TRANSACTION_REPOSITORY],
})
export class TransactionsModule {}
