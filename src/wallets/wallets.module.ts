import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsModule } from '../accounts/accounts.module';
import { Wallet, WalletSchema } from './wallet.schema';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [
    AccountsModule,
    MongooseModule.forFeature([{ name: Wallet.name, schema: WalletSchema }]),
  ],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService, MongooseModule],
})
export class WalletsModule {}
