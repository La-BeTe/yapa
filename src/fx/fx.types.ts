import type { CurrencyCode } from '../common/money/currency';

/** Units of each currency per 1 USD, as decimal strings, from the live provider. */
export interface LiveSnapshot {
  rates: Record<CurrencyCode, string>;
  /** When the provider says its rates were last updated. */
  refreshed_at: string;
}

export type RateSource = 'live' | 'static' | 'fallback';

export interface FxQuote {
  base_currency: CurrencyCode;
  quote_currency: CurrencyCode;
  mid_rate: string;
  spread_bps: number;
  /** Rate after the spread, i.e. what the client effectively gets. */
  effective_rate: string;
  source: RateSource;
  refreshed_at: string;
}

export interface StoredRate {
  base_currency: CurrencyCode;
  quote_currency: CurrencyCode;
  rate: string;
  spread_bps: number;
  prefer_static: boolean;
  source: 'provider' | 'admin';
  updated_at: Date;
}

export interface RateUpdate {
  rate?: string;
  spread_bps?: number;
  prefer_static?: boolean;
}

export const LIVE_RATE_PROVIDER = Symbol('LIVE_RATE_PROVIDER');
export const FX_RATE_STORE = Symbol('FX_RATE_STORE');
export const LIVE_RATE_CACHE = Symbol('LIVE_RATE_CACHE');

export interface LiveRateProvider {
  fetch(): Promise<LiveSnapshot>;
}

export interface FxRateStore {
  find(base: CurrencyCode, quote: CurrencyCode): Promise<StoredRate | null>;
  findAll(): Promise<StoredRate[]>;
  /** Inserts missing pairs and refreshes the rate of pairs that do not prefer static rates. */
  syncFromLive(
    rates: Array<{ base: CurrencyCode; quote: CurrencyCode; rate: string }>,
    defaultSpreadBps: number,
  ): Promise<void>;
  update(base: CurrencyCode, quote: CurrencyCode, update: RateUpdate): Promise<StoredRate | null>;
}

export interface LiveRateCache {
  get(): Promise<LiveSnapshot | null>;
  set(snapshot: LiveSnapshot, ttlSeconds: number): Promise<void>;
}
