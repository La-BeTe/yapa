import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../common/http/response-message.decorator';
import { TransactionHistoryService } from './transaction-history.service';
import { ListTransactionsQuery } from './transactions.dto';

@ApiTags('wallets')
@Controller('wallets/:id/transactions')
export class WalletTransactionsController {
  constructor(private readonly history: TransactionHistoryService) {}

  @Get()
  @ApiOperation({
    summary: "List a wallet's transactions, newest first",
    description:
      'Includes deposits, swaps and transfers sent and received; filter by type and currency.',
  })
  @ResponseMessage('Transactions retrieved')
  list(@Param('id') id: string, @Query() query: ListTransactionsQuery) {
    return this.history.list(id, query);
  }
}
