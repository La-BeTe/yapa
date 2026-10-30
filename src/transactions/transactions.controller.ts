import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Envelope } from '../common/http/envelope';
import { RawEnvelope } from '../common/http/response-envelope.interceptor';
import { ResponseMessage } from '../common/http/response-message.decorator';
import { presentTransaction } from './transaction.presenter';
import { CreateTransactionDto } from './transactions.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  @ApiOperation({
    summary: 'Deposit, swap or transfer funds',
    description:
      'Idempotent on unique_reference: retrying the same request returns the original status and body without moving money again.',
  })
  async create(
    @Body() dto: CreateTransactionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { http_status, body } = await this.transactions.create(dto, req.requestId);
    res.status(http_status);
    return new RawEnvelope(body as Envelope<unknown>);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a transaction by id' })
  @ResponseMessage('Transaction retrieved')
  async get(@Param('id') id: string) {
    return presentTransaction(await this.transactions.get(id));
  }
}
