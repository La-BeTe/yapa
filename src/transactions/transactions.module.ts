import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsModule } from '../accounts/accounts.module';
import { WalletsModule } from '../wallets/wallets.module';
import { MongoTransactionRepository } from './mongo-transaction.repository';
import { TRANSACTION_FINALIZED_HOOKS, TransactionExecutor } from './transaction.executor';
import { Transaction, TransactionSchema } from './transaction.schema';
import { TRANSACTION_REPOSITORY } from './transaction.types';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [
    AccountsModule,
    WalletsModule,
    MongooseModule.forFeature([{ name: Transaction.name, schema: TransactionSchema }]),
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    TransactionExecutor,
    { provide: TRANSACTION_REPOSITORY, useClass: MongoTransactionRepository },
    { provide: TRANSACTION_FINALIZED_HOOKS, useValue: [] },
  ],
  exports: [TransactionsService, TransactionExecutor, TRANSACTION_REPOSITORY],
})
export class TransactionsModule {}
