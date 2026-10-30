import { AppError, ErrorCode } from '../http/app-error';

export const CURRENCY_CODES = ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface Currency {
  code: CurrencyCode;
  /** TigerBeetle ledger holding this currency; transfers never cross ledgers. */
  ledger: number;
  /** Number of decimal places in one major unit (amounts are stored as integers of 10^-scale). */
  scale: number;
  /** ISO 4217 fiat code the stablecoin tracks, used to look up live FX rates. */
  fiat: string;
}

export const CURRENCIES: Readonly<Record<CurrencyCode, Currency>> = {
  cNGN: { code: 'cNGN', ledger: 1, scale: 2, fiat: 'NGN' },
  cGHS: { code: 'cGHS', ledger: 2, scale: 2, fiat: 'GHS' },
  cXAF: { code: 'cXAF', ledger: 3, scale: 0, fiat: 'XAF' },
  USDx: { code: 'USDx', ledger: 4, scale: 2, fiat: 'USD' },
  EURx: { code: 'EURx', ledger: 5, scale: 2, fiat: 'EUR' },
};

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCY_CODES as readonly string[]).includes(value);
}

export function getCurrency(code: string): Currency {
  if (!isCurrencyCode(code)) {
    throw new AppError(ErrorCode.UNSUPPORTED_CURRENCY, `Unsupported currency: ${code}`);
  }
  return CURRENCIES[code];
}

/** All ordered (base, quote) pairs of distinct supported currencies. */
export function currencyPairs(): Array<[CurrencyCode, CurrencyCode]> {
  return CURRENCY_CODES.flatMap((base) =>
    CURRENCY_CODES.filter((quote) => quote !== base).map(
      (quote) => [base, quote] as [CurrencyCode, CurrencyCode],
    ),
  );
}
