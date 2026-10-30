import Decimal from 'decimal.js';
import { AppError, ErrorCode } from '../http/app-error';

/** Isolated Decimal constructor: generous precision, and every rounding truncates toward zero. */
export const Dec = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_DOWN });

/** Upper bound for a single amount: fits in a signed 64-bit integer, far below u128. */
export const MAX_AMOUNT = (1n << 63n) - 1n;
const MINOR_UNITS_PATTERN = /^[1-9]\d*$/;
/**
 * Rates are rounded to nearest at 20 significant digits. The rounded rate is the rate that is
 * recorded and applied, so `floor(amount × recorded rate)` is always reproducible; truncating
 * instead would turn exact results such as 1500 NGN -> 1 USD into 0.99.
 */
const RATE_SIGNIFICANT_DIGITS = 20;
const BPS_DENOMINATOR = 10_000n;

/** Parses a positive integer string of minor units (e.g. "150025" = 1500.25 at scale 2). */
export function parseMinorUnits(value: string): bigint {
  if (!MINOR_UNITS_PATTERN.test(value)) {
    throw new AppError(
      ErrorCode.INVALID_AMOUNT,
      'Amount must be a positive integer string in minor units',
    );
  }
  const amount = BigInt(value);
  if (amount > MAX_AMOUNT) {
    throw new AppError(ErrorCode.INVALID_AMOUNT, `Amount must not exceed ${MAX_AMOUNT}`);
  }
  return amount;
}

/** Renders minor units as a major-unit decimal string, e.g. (150025n, 2) -> "1500.25". */
export function toMajorUnits(amount: bigint, scale: number): string {
  return new Dec(amount.toString()).div(new Dec(10).pow(scale)).toFixed(scale);
}

/** Normalises a positive rate to a canonical decimal string. */
export function normaliseRate(rate: Decimal.Value): string {
  const value = new Dec(rate);
  if (!value.isFinite() || value.lte(0)) {
    throw new Error(`Invalid FX rate: ${String(rate)}`);
  }
  return value.toSignificantDigits(RATE_SIGNIFICANT_DIGITS, Decimal.ROUND_HALF_UP).toFixed();
}

/**
 * Cross rate between two currencies from rates quoted against a common base:
 * if 1 USD = baseRate units of A and quoteRate units of B, then 1 A = quoteRate / baseRate B.
 */
export function crossRate(baseRate: Decimal.Value, quoteRate: Decimal.Value): string {
  return normaliseRate(new Dec(quoteRate).div(new Dec(baseRate)));
}

/** Applies a spread (in basis points) to a mid rate, as quoted to clients. */
export function applySpread(midRate: Decimal.Value, spreadBps: number): string {
  return normaliseRate(new Dec(midRate).mul(new Dec(10_000 - spreadBps)).div(10_000));
}

export interface ConversionInput {
  amount: bigint;
  fromScale: number;
  toScale: number;
  /** Units of the destination currency per one unit of the source currency (major units). */
  midRate: string;
  spreadBps: number;
}

export interface ConversionResult {
  /** Destination amount at the mid rate, before the spread fee (minor units). */
  gross: bigint;
  /** Spread fee kept by the platform, in destination minor units. */
  fee: bigint;
  /** Amount actually credited to the destination (minor units). */
  net: bigint;
}

/**
 * Converts minor units of one currency into another. Every step rounds down, so the client
 * never receives more than the exact value and sub-unit residue stays with the platform.
 */
export function convert({
  amount,
  fromScale,
  toScale,
  midRate,
  spreadBps,
}: ConversionInput): ConversionResult {
  if (amount <= 0n) {
    throw new AppError(ErrorCode.INVALID_AMOUNT, 'Amount must be positive');
  }
  if (!Number.isInteger(spreadBps) || spreadBps < 0 || spreadBps >= 10_000) {
    throw new Error(`Invalid spread: ${spreadBps}`);
  }

  const exact = new Dec(amount.toString())
    .mul(new Dec(midRate))
    .mul(new Dec(10).pow(toScale - fromScale));
  const gross = BigInt(exact.toFixed(0, Decimal.ROUND_DOWN));
  const fee = (gross * BigInt(spreadBps)) / BPS_DENOMINATOR;
  const net = gross - fee;

  if (net <= 0n) {
    throw new AppError(
      ErrorCode.AMOUNT_TOO_SMALL,
      'Amount is too small to convert into the destination currency',
    );
  }
  return { gross, fee, net };
}
