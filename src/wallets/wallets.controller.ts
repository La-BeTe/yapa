import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '../common/http/response-message.decorator';
import { presentWallet, presentWalletWithBalances } from './wallet.presenter';
import { CreateWalletDto } from './wallets.dto';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a wallet identified by a unique email and/or phone number' })
  @ResponseMessage('Wallet created')
  async create(@Body() dto: CreateWalletDto, @Req() req: Request) {
    const { wallet } = await this.wallets.create(dto, req.requestId);
    return presentWallet(wallet);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a wallet with its balance per currency and total value in USD' })
  @ResponseMessage('Wallet retrieved')
  async get(@Param('id') id: string) {
    return presentWalletWithBalances(await this.wallets.getWithBalances(id));
  }
}
