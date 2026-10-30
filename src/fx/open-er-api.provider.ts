import { Injectable } from '@nestjs/common';
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from '../common/money/currency';
import { normaliseRate } from '../common/money/money';
import { AppConfigService } from '../config/app-config.service';
import type { LiveRateProvider, LiveSnapshot } from './fx.types';

interface OpenErApiResponse {
  result?: string;
  base_code?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

/**
 * Live rates from open.er-api.com (keyless, USD-based, covers NGN/GHS/XAF/EUR).
 * Each stablecoin is pegged 1:1 to the fiat currency it tracks.
 */
@Injectable()
export class OpenErApiProvider implements LiveRateProvider {
  constructor(private readonly config: AppConfigService) {}

  async fetch(): Promise<LiveSnapshot> {
    const response = await fetch(this.config.get('FX_API_URL'), {
      signal: AbortSignal.timeout(this.config.get('FX_TIMEOUT_MS')),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`FX provider responded with HTTP ${response.status}`);
    }
    return parseOpenErApi((await response.json()) as OpenErApiResponse);
  }
}

export function parseOpenErApi(body: OpenErApiResponse): LiveSnapshot {
  if (body.result !== 'success' || body.base_code !== 'USD' || !body.rates) {
    throw new Error('FX provider returned an unexpected payload');
  }
  const rates = {} as Record<CurrencyCode, string>;
  for (const code of CURRENCY_CODES) {
    const value = body.rates[CURRENCIES[code].fiat];
    if (typeof value !== 'number' || !(value > 0)) {
      throw new Error(`FX provider is missing a rate for ${CURRENCIES[code].fiat}`);
    }
    rates[code] = normaliseRate(value);
  }
  const refreshedAt = body.time_last_update_unix
    ? new Date(body.time_last_update_unix * 1000)
    : new Date();
  return { rates, refreshed_at: refreshedAt.toISOString() };
}
