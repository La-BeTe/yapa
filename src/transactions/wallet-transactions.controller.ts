import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors, ApiSuccess, examples } from '../common/http/api-docs';
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
      'Includes deposits, swaps and transfers sent and received. Filter by type and by currency (either side). Pass next_cursor as cursor to get the next page.',
  })
  @ApiSuccess(200, 'Transactions retrieved', {
    items: [{ ...examples.transaction, direction: 'OUT' }],
    next_cursor: null,
    limit: 20,
  })
  @ApiErrors([404, 'WALLET_NOT_FOUND', 'Wallet 01J... was not found'])
  @ResponseMessage('Transactions retrieved')
  list(@Param('id') id: string, @Query() query: ListTransactionsQuery) {
    return this.history.list(id, query);
  }
}
