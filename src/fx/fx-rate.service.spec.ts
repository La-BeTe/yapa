import {
  InMemoryLiveRateCache,
  InMemoryRateStore,
  StubRateProvider,
} from '../../test/support/in-memory-fx';
import { AppError } from '../common/http/app-error';
import type { AppConfigService } from '../config/app-config.service';
import { validateEnv } from '../config/env.schema';
import { FxRateService } from './fx-rate.service';
import { parseOpenErApi } from './open-er-api.provider';

describe('FxRateService', () => {
  let provider: StubRateProvider;
  let store: InMemoryRateStore;
  let cache: InMemoryLiveRateCache;
  let fx: FxRateService;

  beforeEach(() => {
    provider = new StubRateProvider();
    store = new InMemoryRateStore();
    cache = new InMemoryLiveRateCache();
    const env = validateEnv({ FX_DEFAULT_SPREAD_BPS: '50' });
    const config = { get: (key: keyof typeof env) => env[key] } as AppConfigService;
    fx = new FxRateService(provider, store, cache, config);
  });

  const errorCode = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error instanceof AppError ? error.code : 'OTHER';
    }
    return 'NONE';
  };

  it('populates missing pairs from the provider and quotes live rates', async () => {
    const quote = await fx.quote('cNGN', 'cGHS');
    expect(quote).toEqual({
      base_currency: 'cNGN',
      quote_currency: 'cGHS',
      mid_rate: '0.0083333333333333333333',
      spread_bps: 50,
      effective_rate: '0.0082916666666666666666',
      source: 'live',
      refreshed_at: provider.refreshedAt,
    });
    expect(store.rows.size).toBe(20);
    expect(store.rows.get('cNGN/cGHS')?.rate).toBe('0.0083333333333333333333');
  });

  it('serves live rates from the cache until it expires', async () => {
    await fx.quote('cNGN', 'USDx');
    await fx.quote('USDx', 'cNGN');
    expect(provider.calls).toBe(1);
    cache.expire();
    await fx.quote('USDx', 'cNGN');
    expect(provider.calls).toBe(2);
  });

  it('fetches once for concurrent quotes when the cache is cold', async () => {
    await Promise.all([
      fx.quote('cNGN', 'USDx'),
      fx.quote('cGHS', 'EURx'),
      fx.quote('USDx', 'cXAF'),
    ]);
    expect(provider.calls).toBe(1);
  });

  it('falls back to the stored rate when the provider fails', async () => {
    await fx.quote('cNGN', 'USDx');
    cache.expire();
    provider.failing = true;
    const quote = await fx.quote('cNGN', 'USDx');
    expect(quote.source).toBe('fallback');
    expect(quote.mid_rate).toBe(store.rows.get('cNGN/USDx')!.rate);
  });

  it('returns 503 FX_RATE_UNAVAILABLE when a pair is missing and the provider is down', async () => {
    provider.failing = true;
    expect(await errorCode(fx.quote('cNGN', 'USDx'))).toBe('FX_RATE_UNAVAILABLE');
    expect(await errorCode(fx.quoteAll())).toBe('FX_RATE_UNAVAILABLE');
  });

  it('uses the stored rate for pairs that prefer static rates', async () => {
    await fx.refresh();
    await fx.updateStored('USDx', 'EURx', { rate: '0.95', prefer_static: true, spread_bps: 10 });
    const quote = await fx.quote('USDx', 'EURx');
    expect(quote).toMatchObject({
      mid_rate: '0.95',
      spread_bps: 10,
      source: 'static',
      effective_rate: '0.94905',
    });
  });

  it('does not overwrite admin-pinned static rates on refresh', async () => {
    await fx.refresh();
    await fx.updateStored('USDx', 'EURx', { rate: '0.95', prefer_static: true });
    provider.rates.EURx = '0.8';
    await fx.refresh();
    expect(store.rows.get('USDx/EURx')).toMatchObject({ rate: '0.95', source: 'admin' });
    expect(store.rows.get('EURx/USDx')?.rate).toBe('1.25');
  });

  it('applies the per-pair spread to live rates', async () => {
    await fx.refresh();
    await fx.updateStored('USDx', 'cNGN', { spread_bps: 100 });
    const quote = await fx.quote('USDx', 'cNGN');
    expect(quote).toMatchObject({
      mid_rate: '1500',
      spread_bps: 100,
      effective_rate: '1485',
      source: 'live',
    });
  });

  it('returns quotes for all 20 pairs', async () => {
    const quotes = await fx.quoteAll();
    expect(quotes).toHaveLength(20);
  });

  it('values balances in USD at the mid rate, rounding down', async () => {
    expect(await fx.valueInUsd(150000n, 'cNGN')).toBe(100n); // 1,500.00 NGN = 1.00 USD
    expect(await fx.valueInUsd(1000n, 'cXAF')).toBe(166n); // 1,000 XAF = 1.666 USD -> 1.66
    expect(await fx.valueInUsd(12345n, 'USDx')).toBe(12345n);
    expect(await fx.valueInUsd(0n, 'cGHS')).toBe(0n);
    expect(await fx.valueInUsd(1n, 'cNGN')).toBe(0n); // dust
  });

  it('rejects updates to unknown pairs', async () => {
    expect(await errorCode(fx.updateStored('USDx', 'EURx', { spread_bps: 1 }))).toBe('NOT_FOUND');
  });
});

describe('parseOpenErApi', () => {
  const body = {
    result: 'success',
    base_code: 'USD',
    time_last_update_unix: 1_790_000_000,
    rates: { USD: 1, NGN: 1532.12, GHS: 15.3, XAF: 590.5, EUR: 0.91, GBP: 0.8 },
  };

  it('maps fiat rates onto stablecoins', () => {
    expect(parseOpenErApi(body)).toEqual({
      rates: { cNGN: '1532.12', cGHS: '15.3', cXAF: '590.5', USDx: '1', EURx: '0.91' },
      refreshed_at: new Date(1_790_000_000 * 1000).toISOString(),
    });
  });

  it('rejects failed or incomplete payloads', () => {
    expect(() => parseOpenErApi({ ...body, result: 'error' })).toThrow();
    expect(() => parseOpenErApi({ ...body, rates: { USD: 1 } })).toThrow(/NGN/);
    expect(() => parseOpenErApi({ ...body, rates: { ...body.rates, GHS: 0 } })).toThrow(/GHS/);
  });
});
