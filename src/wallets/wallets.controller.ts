import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrors, ApiSuccess, examples } from '../common/http/api-docs';
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
  @ApiSuccess(201, 'Wallet created', examples.wallet)
  @ApiErrors(
    [400, 'VALIDATION_ERROR', 'Provide an email address or a phone number'],
    [409, 'WALLET_ALREADY_EXISTS', 'A wallet with this email or phone number already exists'],
  )
  @ResponseMessage('Wallet created')
  async create(@Body() dto: CreateWalletDto, @Req() req: Request) {
    const { wallet } = await this.wallets.create(dto, req.requestId);
    return presentWallet(wallet);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a wallet with its balance per currency and total value in USD',
    description:
      'total_usd is valued at mid rates (no spread) and is null when no FX rate is available.',
  })
  @ApiSuccess(200, 'Wallet retrieved', examples.walletWithBalances)
  @ApiErrors([404, 'WALLET_NOT_FOUND', 'Wallet 01J... was not found'])
  @ResponseMessage('Wallet retrieved')
  async get(@Param('id') id: string) {
    return presentWalletWithBalances(await this.wallets.getWithBalances(id));
  }
}
