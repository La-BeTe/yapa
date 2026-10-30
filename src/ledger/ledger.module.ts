import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { tigerBeetleClientProvider } from './tigerbeetle.provider';

@Global()
@Module({
  providers: [tigerBeetleClientProvider, LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
