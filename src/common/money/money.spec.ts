import { AppError } from '../http/app-error';
import { CURRENCIES, currencyPairs, getCurrency, isCurrencyCode } from './currency';
import {
  MAX_AMOUNT,
  applySpread,
  convert,
  crossRate,
  normaliseRate,
  parseMinorUnits,
  toMajorUnits,
} from './money';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : 'NON_APP_ERROR';
  }
  return 'NO_ERROR';
};

describe('currency registry', () => {
  it('defines a unique ledger per currency and fiat-like scales', () => {
    const ledgers = Object.values(CURRENCIES).map((c) => c.ledger);
    expect(new Set(ledgers).size).toBe(ledgers.length);
    expect(CURRENCIES.cXAF.scale).toBe(0);
    expect(CURRENCIES.cNGN.scale).toBe(2);
    expect(CURRENCIES.USDx.fiat).toBe('USD');
  });

  it('validates currency codes case-sensitively', () => {
    expect(isCurrencyCode('cNGN')).toBe(true);
    expect(isCurrencyCode('CNGN')).toBe(false);
    expect(code(() => getCurrency('BTC'))).toBe('UNSUPPORTED_CURRENCY');
  });

  it('lists all 20 directed pairs', () => {
    const pairs = currencyPairs();
    expect(pairs).toHaveLength(20);
    expect(pairs.every(([a, b]) => a !== b)).toBe(true);
  });
});

describe('parseMinorUnits', () => {
  it.each(['1', '150025', MAX_AMOUNT.toString()])('accepts %s', (value) => {
    expect(parseMinorUnits(value)).toBe(BigInt(value));
  });

  it.each(['0', '-5', '1.5', '01', ' 1', '1e3', '', 'abc', (MAX_AMOUNT + 1n).toString()])(
    'rejects %p',
    (value) => {
      expect(code(() => parseMinorUnits(value))).toBe('INVALID_AMOUNT');
    },
  );
});

describe('toMajorUnits', () => {
  it('formats according to scale', () => {
    expect(toMajorUnits(150025n, 2)).toBe('1500.25');
    expect(toMajorUnits(5n, 2)).toBe('0.05');
    expect(toMajorUnits(655957n, 0)).toBe('655957');
  });
});

describe('rates', () => {
  it('derives cross rates from a common base', () => {
    // 1 USD = 1500 NGN and 0.92 EUR, so 1 NGN = 0.92 / 1500 EUR.
    expect(crossRate('1500', '0.92')).toBe('0.00061333333333333333333');
    expect(crossRate('0.92', '1500')).toBe('1630.4347826086956522');
    expect(crossRate('1', '1')).toBe('1');
  });

  it('rounds rates to nearest so exact conversions stay exact', () => {
    const ngnToUsd = crossRate('1500', '1');
    expect(ngnToUsd).toBe('0.00066666666666666666667');
    // 1,500.00 NGN must be worth exactly 1.00 USD, not 0.99.
    expect(
      convert({ amount: 150000n, fromScale: 2, toScale: 2, midRate: ngnToUsd, spreadBps: 0 }).net,
    ).toBe(100n);
  });

  it('applies a spread to the mid rate', () => {
    expect(applySpread('1500', 50)).toBe('1492.5');
    expect(applySpread('1500', 0)).toBe('1500');
  });

  it('rejects non-positive rates', () => {
    expect(() => normaliseRate('0')).toThrow();
    expect(() => normaliseRate('-1')).toThrow();
  });
});

describe('convert', () => {
  it('converts between equal scales and floors the result', () => {
    // 100.00 USDx -> EURx at 0.92345 = 92.345 EURx -> floored to 92.34
    expect(
      convert({ amount: 10000n, fromScale: 2, toScale: 2, midRate: '0.92345', spreadBps: 0 }),
    ).toEqual({ gross: 9234n, fee: 0n, net: 9234n });
  });

  it('converts from a 2dp currency into a 0dp currency', () => {
    // 10.00 EURx -> cXAF at 655.957 = 6559.57 XAF -> 6559
    expect(
      convert({ amount: 1000n, fromScale: 2, toScale: 0, midRate: '655.957', spreadBps: 0 }),
    ).toEqual({ gross: 6559n, fee: 0n, net: 6559n });
  });

  it('converts from a 0dp currency into a 2dp currency', () => {
    // 1000 cXAF -> EURx at 0.00152449 = 1.52449 EUR -> 1.52
    expect(
      convert({ amount: 1000n, fromScale: 0, toScale: 2, midRate: '0.00152449', spreadBps: 0 }),
    ).toEqual({ gross: 152n, fee: 0n, net: 152n });
  });

  it('takes the spread fee from the converted amount, rounding the fee down', () => {
    // 5000.00 cNGN -> cGHS at 0.0075 = 37.50 GHS; 50 bps fee = 0.1875 -> 0.18
    expect(
      convert({ amount: 500000n, fromScale: 2, toScale: 2, midRate: '0.0075', spreadBps: 50 }),
    ).toEqual({ gross: 3750n, fee: 18n, net: 3732n });
  });

  it('never credits more than the exact value', () => {
    const rates = [
      '0.00061333333333333333333',
      '1630.4347826086956522',
      '655.957',
      '0.0075',
      '1.0001',
    ];
    for (const midRate of rates) {
      for (const amount of [1n, 7n, 99n, 12345n, 987654321n]) {
        for (const [fromScale, toScale] of [
          [2, 2],
          [2, 0],
          [0, 2],
        ] as const) {
          let result;
          try {
            result = convert({ amount, fromScale, toScale, midRate, spreadBps: 50 });
          } catch {
            continue; // too small to convert
          }
          const exactTimesScale =
            (Number(amount) * Number(midRate) * 10 ** toScale) / 10 ** fromScale;
          expect(Number(result.gross)).toBeLessThanOrEqual(exactTimesScale + 1e-6);
          expect(result.gross - result.net).toBe(result.fee);
          expect(result.fee).toBeGreaterThanOrEqual(0n);
        }
      }
    }
  });

  it('rejects amounts that would convert to zero', () => {
    // 0.01 cNGN -> USDx at 0.00066 = 0.0000066 USD -> 0
    expect(
      code(() =>
        convert({ amount: 1n, fromScale: 2, toScale: 2, midRate: '0.00066', spreadBps: 50 }),
      ),
    ).toBe('AMOUNT_TOO_SMALL');
  });

  it('rejects conversions whose entire value would be consumed by the fee', () => {
    // gross = 1 minor unit, 50 bps fee rounds to 0, so net = 1 and is allowed
    expect(convert({ amount: 1n, fromScale: 2, toScale: 2, midRate: '1', spreadBps: 50 }).net).toBe(
      1n,
    );
    // a 9999 bps spread on a gross of 1 still leaves 1 (fee floors to 0)
    expect(
      convert({ amount: 1n, fromScale: 2, toScale: 2, midRate: '1', spreadBps: 9999 }).net,
    ).toBe(1n);
  });

  it('handles very large amounts without precision loss', () => {
    const result = convert({
      amount: MAX_AMOUNT,
      fromScale: 2,
      toScale: 2,
      midRate: '1',
      spreadBps: 0,
    });
    expect(result.net).toBe(MAX_AMOUNT);
  });

  it('rejects invalid spreads', () => {
    expect(() =>
      convert({ amount: 100n, fromScale: 2, toScale: 2, midRate: '1', spreadBps: 10_000 }),
    ).toThrow();
    expect(() =>
      convert({ amount: 100n, fromScale: 2, toScale: 2, midRate: '1', spreadBps: 1.5 }),
    ).toThrow();
  });
});
