import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AppError, ErrorCode } from '../common/http/app-error';
import { CURRENCIES, currencyPairs, type CurrencyCode } from '../common/money/currency';
import { applySpread, convert, crossRate, normaliseRate } from '../common/money/money';
import { AppConfigService } from '../config/app-config.service';
import {
  FX_RATE_STORE,
  FxQuote,
  type FxRateStore,
  LIVE_RATE_CACHE,
  LIVE_RATE_PROVIDER,
  type LiveRateCache,
  type LiveRateProvider,
  LiveSnapshot,
  RateUpdate,
  StoredRate,
} from './fx.types';

/**
 * Resolves the rate for a currency pair:
 *   1. the pair must exist in fx_rates; if it does not, it is populated from the provider
 *      (and if the provider is down, the rate is unavailable),
 *   2. pairs flagged prefer_static use the stored rate,
 *   3. otherwise the live rate is used (Redis-cached, refetched when stale),
 *   4. if live rates cannot be obtained, the stored rate is the fallback.
 * The spread always comes from the pair's fx_rates row.
 */
@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);
  private inflight: Promise<LiveSnapshot | null> | null = null;

  constructor(
    @Inject(LIVE_RATE_PROVIDER) private readonly provider: LiveRateProvider,
    @Inject(FX_RATE_STORE) private readonly store: FxRateStore,
    @Inject(LIVE_RATE_CACHE) private readonly cache: LiveRateCache,
    private readonly config: AppConfigService,
  ) {}

  async quote(base: CurrencyCode, quote: CurrencyCode): Promise<FxQuote> {
    if (base === quote) {
      throw new Error('Cannot quote a currency against itself');
    }
    let row = await this.store.find(base, quote);
    if (!row) {
      await this.liveSnapshot();
      row = await this.store.find(base, quote);
      if (!row) {
        throw rateUnavailable(base, quote);
      }
    }
    if (row.prefer_static) {
      return fromStored(row, 'static');
    }
    const snapshot = await this.liveSnapshot();
    if (!snapshot) {
      return fromStored(row, 'fallback');
    }
    const mid = crossRate(snapshot.rates[base], snapshot.rates[quote]);
    return buildQuote(base, quote, mid, row.spread_bps, 'live', snapshot.refreshed_at);
  }

  /** Quotes for every supported pair; pairs that cannot be resolved are omitted. */
  async quoteAll(): Promise<FxQuote[]> {
    const quotes = await Promise.all(
      currencyPairs().map(([base, quote]) =>
        this.quote(base, quote).catch((error: unknown) => {
          if (error instanceof AppError && error.code === ErrorCode.FX_RATE_UNAVAILABLE) {
            return null;
          }
          throw error;
        }),
      ),
    );
    const available = quotes.filter((q): q is FxQuote => q !== null);
    if (available.length === 0) {
      throw new AppError(
        ErrorCode.FX_RATE_UNAVAILABLE,
        'FX rates are currently unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return available;
  }

  /** Values an amount in USDx minor units at the mid rate (no spread), rounding down. */
  async valueInUsd(amount: bigint, currency: CurrencyCode): Promise<bigint> {
    if (amount === 0n) {
      return 0n;
    }
    if (currency === 'USDx') {
      return amount;
    }
    const { mid_rate } = await this.quote(currency, 'USDx');
    try {
      return convert({
        amount,
        fromScale: CURRENCIES[currency].scale,
        toScale: CURRENCIES.USDx.scale,
        midRate: mid_rate,
        spreadBps: 0,
      }).net;
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCode.AMOUNT_TOO_SMALL) {
        return 0n;
      }
      throw error;
    }
  }

  /** Fetches live rates now, bypassing the cache, and syncs them into fx_rates. */
  async refresh(): Promise<LiveSnapshot> {
    const snapshot = await this.provider.fetch();
    await this.cache.set(snapshot, this.config.get('FX_LIVE_TTL_SECONDS'));
    await this.store.syncFromLive(
      currencyPairs().map(([base, quote]) => ({
        base,
        quote,
        rate: crossRate(snapshot.rates[base], snapshot.rates[quote]),
      })),
      this.config.get('FX_DEFAULT_SPREAD_BPS'),
    );
    return snapshot;
  }

  listStored(): Promise<StoredRate[]> {
    return this.store.findAll();
  }

  async updateStored(
    base: CurrencyCode,
    quote: CurrencyCode,
    update: RateUpdate,
  ): Promise<StoredRate> {
    if (base === quote) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Base and quote currencies must differ',
        HttpStatus.BAD_REQUEST,
      );
    }
    const normalised =
      update.rate === undefined ? update : { ...update, rate: normaliseRate(update.rate) };
    const updated = await this.store.update(base, quote, normalised);
    if (!updated) {
      throw AppError.notFound(ErrorCode.NOT_FOUND, `No stored rate for ${base}/${quote}`);
    }
    return updated;
  }

  /** Cached live snapshot, refetching (once, even under concurrency) when stale. */
  private async liveSnapshot(): Promise<LiveSnapshot | null> {
    const cached = await this.cache.get().catch(() => null);
    if (cached) {
      return cached;
    }
    this.inflight ??= this.refresh()
      .catch((error: Error) => {
        this.logger.warn(`Live FX rates unavailable: ${error.message}`);
        return null;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}

function fromStored(row: StoredRate, source: 'static' | 'fallback'): FxQuote {
  return buildQuote(
    row.base_currency,
    row.quote_currency,
    row.rate,
    row.spread_bps,
    source,
    new Date(row.updated_at).toISOString(),
  );
}

function buildQuote(
  base: CurrencyCode,
  quote: CurrencyCode,
  mid: string,
  spreadBps: number,
  source: FxQuote['source'],
  refreshedAt: string,
): FxQuote {
  return {
    base_currency: base,
    quote_currency: quote,
    mid_rate: mid,
    spread_bps: spreadBps,
    effective_rate: applySpread(mid, spreadBps),
    source,
    refreshed_at: refreshedAt,
  };
}

function rateUnavailable(base: CurrencyCode, quote: CurrencyCode): AppError {
  return new AppError(
    ErrorCode.FX_RATE_UNAVAILABLE,
    `No FX rate is available for ${base}/${quote}`,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
