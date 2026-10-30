import { isValid, monotonicFactory } from 'ulid';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_LENGTH = 26;
const MAX_U128 = (1n << 128n) - 1n;

const nextUlid = monotonicFactory();

/** Generates a monotonic ULID; IDs created within the same millisecond still sort in order. */
export function newId(): string {
  return nextUlid();
}

export function isUlid(value: unknown): value is string {
  // The first character only carries 3 bits; anything above '7' overflows 128 bits.
  return (
    typeof value === 'string' &&
    value.length === ULID_LENGTH &&
    isValid(value.toUpperCase()) &&
    value[0]! <= '7'
  );
}

/**
 * Decodes a ULID into the 128-bit unsigned integer it represents. TigerBeetle IDs are u128,
 * and ULIDs are time-ordered, which matches TigerBeetle's recommendation for ID locality.
 */
export function ulidToBigInt(id: string): bigint {
  if (!isUlid(id)) {
    throw new Error(`Invalid ULID: ${String(id)}`);
  }
  let value = 0n;
  for (const char of id.toUpperCase()) {
    value = (value << 5n) | BigInt(CROCKFORD.indexOf(char));
  }
  return value;
}

export function bigIntToUlid(value: bigint): string {
  if (value < 0n || value > MAX_U128) {
    throw new Error(`Value out of u128 range: ${value}`);
  }
  let remaining = value;
  let out = '';
  for (let i = 0; i < ULID_LENGTH; i++) {
    out = CROCKFORD.charAt(Number(remaining & 31n)) + out;
    remaining >>= 5n;
  }
  return out;
}
