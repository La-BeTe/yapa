import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/auth/admin-key.guard';
import { ResponseMessage } from '../common/http/response-message.decorator';
import { FxRateService } from './fx-rate.service';
import { PairParams, UpdateFxRateDto } from './fx-rates.dto';
import type { StoredRate } from './fx.types';

@Controller('fx-rates')
export class FxRatesController {
  constructor(private readonly fx: FxRateService) {}

  @Get()
  @ResponseMessage('FX rates retrieved')
  list() {
    return this.fx.quoteAll();
  }
}

@Controller('admin/fx-rates')
@UseGuards(AdminKeyGuard)
export class AdminFxRatesController {
  constructor(private readonly fx: FxRateService) {}

  @Get()
  @ResponseMessage('Stored FX rates retrieved')
  async list() {
    return (await this.fx.listStored()).map(present);
  }

  @Patch(':base/:quote')
  @ResponseMessage('FX rate updated')
  async update(@Param() { base, quote }: PairParams, @Body() body: UpdateFxRateDto) {
    return present(await this.fx.updateStored(base, quote, body));
  }
}

function present(row: StoredRate) {
  return {
    base_currency: row.base_currency,
    quote_currency: row.quote_currency,
    rate: row.rate,
    spread_bps: row.spread_bps,
    prefer_static: row.prefer_static,
    source: row.source,
    updated_at: new Date(row.updated_at).toISOString(),
  };
}
