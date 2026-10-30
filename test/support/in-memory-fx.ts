import type { CurrencyCode } from '../../src/common/money/currency';
import type {
  FxRateStore,
  LiveRateCache,
  LiveRateProvider,
  LiveSnapshot,
  RateUpdate,
  StoredRate,
} from '../../src/fx/fx.types';

/** USD-based rates used across tests (units per 1 USD). */
export const TEST_USD_RATES: Record<CurrencyCode, string> = {
  cNGN: '1500',
  cGHS: '12.5',
  cXAF: '600',
  USDx: '1',
  EURx: '0.9',
};

export class StubRateProvider implements LiveRateProvider {
  calls = 0;
  failing = false;
  rates: Record<CurrencyCode, string> = { ...TEST_USD_RATES };
  refreshedAt = '2026-10-30T12:00:00.000Z';

  fetch(): Promise<LiveSnapshot> {
    this.calls++;
    if (this.failing) {
      return Promise.reject(new Error('provider down'));
    }
    return Promise.resolve({ rates: { ...this.rates }, refreshed_at: this.refreshedAt });
  }
}

export class InMemoryRateStore implements FxRateStore {
  readonly rows = new Map<string, StoredRate>();

  find(base: CurrencyCode, quote: CurrencyCode) {
    const row = this.rows.get(`${base}/${quote}`);
    return Promise.resolve(row ? { ...row } : null);
  }

  findAll() {
    return Promise.resolve([...this.rows.values()].map((row) => ({ ...row })));
  }

  syncFromLive(
    rates: Array<{ base: CurrencyCode; quote: CurrencyCode; rate: string }>,
    defaultSpreadBps: number,
  ) {
    for (const { base, quote, rate } of rates) {
      const key = `${base}/${quote}`;
      const existing = this.rows.get(key);
      if (!existing) {
        this.rows.set(key, {
          base_currency: base,
          quote_currency: quote,
          rate,
          spread_bps: defaultSpreadBps,
          prefer_static: false,
          source: 'provider',
          updated_at: new Date(),
        });
      } else if (!existing.prefer_static) {
        this.rows.set(key, { ...existing, rate, source: 'provider', updated_at: new Date() });
      }
    }
    return Promise.resolve();
  }

  update(base: CurrencyCode, quote: CurrencyCode, update: RateUpdate) {
    const key = `${base}/${quote}`;
    const existing = this.rows.get(key);
    if (!existing) {
      return Promise.resolve(null);
    }
    const next: StoredRate = {
      ...existing,
      ...update,
      source: update.rate === undefined ? existing.source : 'admin',
      updated_at: new Date(),
    };
    this.rows.set(key, next);
    return Promise.resolve({ ...next });
  }
}

export class InMemoryLiveRateCache implements LiveRateCache {
  snapshot: LiveSnapshot | null = null;

  get() {
    return Promise.resolve(this.snapshot);
  }

  set(snapshot: LiveSnapshot) {
    this.snapshot = snapshot;
    return Promise.resolve();
  }

  expire() {
    this.snapshot = null;
  }
}
