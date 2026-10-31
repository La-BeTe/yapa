import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrors, ApiSuccess, examples } from '../common/http/api-docs';
import type { Envelope } from '../common/http/envelope';
import { RawEnvelope, WithMeta } from '../common/http/response-envelope.interceptor';
import { ResponseMessage } from '../common/http/response-message.decorator';
import { presentTransaction } from './transaction.presenter';
import { TransactionHistoryService } from './transaction-history.service';
import { CreateTransactionDto, ListTransactionsQuery } from './transactions.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly history: TransactionHistoryService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Deposit, swap or transfer funds',
    description: [
      'Required fields by type:',
      '- DEPOSIT: destination_wallet_id, currency',
      '- SWAP: source_wallet_id, source_currency, destination_currency',
      '- TRANSFER: source_wallet_id, destination_wallet_id, source_currency, destination_currency (defaults to source_currency)',
      '',
      'Idempotent on unique_reference: retrying the same request returns the original status and body',
      'without moving money again. A failed transaction (e.g. insufficient funds) is final; use a new',
      'unique_reference to try again.',
    ].join('\n'),
  })
  @ApiSuccess(201, 'Transaction completed', examples.transaction)
  @ApiErrors(
    [400, 'VALIDATION_ERROR', 'destination_currency is required for SWAP'],
    [404, 'WALLET_NOT_FOUND', 'Wallet 01J... was not found'],
    [
      409,
      'TRANSACTION_IN_PROGRESS',
      'A request with this unique_reference is still being processed',
    ],
    [422, 'INSUFFICIENT_FUNDS', 'Insufficient USDx balance'],
    [503, 'FX_RATE_UNAVAILABLE', 'No FX rate is available for USDx/cGHS'],
  )
  async create(
    @Body() dto: CreateTransactionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { http_status, body } = await this.transactions.create(dto, req.requestId);
    res.status(http_status);
    return new RawEnvelope(body as Envelope<unknown>);
  }

  @Get()
  @ApiOperation({
    summary: "List a wallet's transactions, newest first",
    description:
      'Includes deposits, swaps and transfers sent and received. Filter by type and by currency (either side). Pass meta.next_cursor as cursor to get the next page.',
  })
  @ApiSuccess(200, 'Transactions retrieved', [{ ...examples.transaction, direction: 'OUT' }], {
    next_cursor: null,
    limit: 20,
  })
  @ApiErrors(
    [400, 'VALIDATION_ERROR', 'wallet_id must be a string'],
    [404, 'WALLET_NOT_FOUND', 'Wallet 01J... was not found'],
  )
  @ResponseMessage('Transactions retrieved')
  async list(@Query() query: ListTransactionsQuery) {
    const { items, next_cursor, limit } = await this.history.list(query.wallet_id, query);
    return new WithMeta(items, { next_cursor, limit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a transaction by id' })
  @ApiSuccess(200, 'Transaction retrieved', examples.transaction)
  @ApiErrors([404, 'TRANSACTION_NOT_FOUND', 'Transaction 01J... was not found'])
  @ResponseMessage('Transaction retrieved')
  async get(@Param('id') id: string) {
    return presentTransaction(await this.transactions.get(id));
  }
}
