import { bigIntToUlid, isUlid, newId, ulidToBigInt } from './ulid';

describe('ulid helpers', () => {
  it('generates valid, strictly increasing ids', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    ids.forEach((id) => expect(isUlid(id)).toBe(true));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('round-trips through a u128 bigint', () => {
    for (let i = 0; i < 100; i++) {
      const id = newId();
      expect(bigIntToUlid(ulidToBigInt(id))).toBe(id);
    }
  });

  it('preserves ordering when converted to bigint', () => {
    const a = newId();
    const b = newId();
    expect(ulidToBigInt(a) < ulidToBigInt(b)).toBe(true);
  });

  it('maps the extreme values', () => {
    expect(ulidToBigInt('00000000000000000000000000')).toBe(0n);
    expect(ulidToBigInt('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe((1n << 128n) - 1n);
    expect(bigIntToUlid((1n << 128n) - 1n)).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
  });

  it('rejects invalid input', () => {
    expect(isUlid('not-a-ulid')).toBe(false);
    expect(() => ulidToBigInt('8ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toThrow();
    expect(() => bigIntToUlid(-1n)).toThrow();
    expect(() => bigIntToUlid(1n << 128n)).toThrow();
  });
});
