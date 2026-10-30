import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LedgerAccount, LedgerAccountSchema } from './account.schema';
import { OperatorAccountsService } from './operator-accounts.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: LedgerAccount.name, schema: LedgerAccountSchema }])],
  providers: [OperatorAccountsService],
  exports: [MongooseModule, OperatorAccountsService],
})
export class AccountsModule {}
