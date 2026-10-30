import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  it('applies defaults when variables are missing', () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.TB_CLUSTER_ID).toBe(0n);
    expect(env.FX_DEFAULT_SPREAD_BPS).toBe(50);
    expect(env.JOBS_ENABLED).toBe(true);
  });

  it('coerces string values from the environment', () => {
    const env = validateEnv({ PORT: '8080', TB_CLUSTER_ID: '7', JOBS_ENABLED: 'false' });
    expect(env.PORT).toBe(8080);
    expect(env.TB_CLUSTER_ID).toBe(7n);
    expect(env.JOBS_ENABLED).toBe(false);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => validateEnv({ PORT: 'abc', FX_API_URL: 'not-a-url' })).toThrow(
      /Invalid environment configuration:[\s\S]*PORT[\s\S]*FX_API_URL/,
    );
  });
});
