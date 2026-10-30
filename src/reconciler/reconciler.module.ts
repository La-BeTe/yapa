import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ReconcilerWorker } from './reconciler.worker';

@Module({
  imports: [TransactionsModule, WalletsModule],
  providers: [ReconcilerWorker],
})
export class ReconcilerModule {}
