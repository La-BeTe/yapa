import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from '../common/auth/admin-key.guard';
import { ApiErrors, ApiSuccess, examples } from '../common/http/api-docs';
import { ResponseMessage } from '../common/http/response-message.decorator';
import { FxRateService } from './fx-rate.service';
import { PairParams, UpdateFxRateDto } from './fx-rates.dto';
import type { StoredRate } from './fx.types';

@ApiTags('fx-rates')
@Controller('fx-rates')
export class FxRatesController {
  constructor(private readonly fx: FxRateService) {}

  @Get()
  @ApiOperation({
    summary: 'Current conversion rates between all supported stablecoins',
    description:
      'source is live (provider), static (pair pinned by an admin) or fallback (provider unavailable, last stored rate). refreshed_at is when that rate was last refreshed.',
  })
  @ApiSuccess(200, 'FX rates retrieved', [examples.fxQuote])
  @ApiErrors([503, 'FX_RATE_UNAVAILABLE', 'FX rates are currently unavailable'])
  @ResponseMessage('FX rates retrieved')
  list() {
    return this.fx.quoteAll();
  }
}

@ApiTags('admin')
@ApiSecurity('admin-key')
@Controller('admin/fx-rates')
@UseGuards(AdminKeyGuard)
export class AdminFxRatesController {
  constructor(private readonly fx: FxRateService) {}

  @Get()
  @ApiOperation({ summary: 'List stored (static / fallback) rates and per-pair configuration' })
  @ResponseMessage('Stored FX rates retrieved')
  async list() {
    return (await this.fx.listStored()).map(present);
  }

  @Patch(':base/:quote')
  @ApiOperation({ summary: 'Set the static rate, spread or prefer_static flag of a pair' })
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
