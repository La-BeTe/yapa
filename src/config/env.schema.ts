import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: port.default(3000),

  MONGO_URI: z.string().min(1).default('mongodb://localhost:27017/yapa'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  TB_CLUSTER_ID: z.coerce.bigint().nonnegative().default(0n),
  TB_ADDRESS: z.string().min(1).default('127.0.0.1:3001'),
  TB_REQUEST_TIMEOUT_MS: positiveInt.default(5000),

  ADMIN_API_KEY: z.string().min(8).default('change-me'),

  FX_API_URL: z.url().default('https://open.er-api.com/v6/latest/USD'),
  FX_TIMEOUT_MS: positiveInt.default(3000),
  FX_LIVE_TTL_SECONDS: positiveInt.default(900),
  FX_REFRESH_EVERY_MS: positiveInt.default(10 * 60 * 1000),
  FX_DEFAULT_SPREAD_BPS: z.coerce.number().int().min(0).max(10_000).default(50),

  RECONCILER_EVERY_MS: positiveInt.default(30_000),
  RECONCILER_STALE_AFTER_MS: positiveInt.default(15_000),

  TX_LIST_CACHE_TTL_SECONDS: positiveInt.default(60),
  REQUEST_LOG_TTL_DAYS: positiveInt.default(30),

  /** Disable repeatable jobs and workers (useful for tests that drive jobs by hand). */
  JOBS_ENABLED: booleanFlag.default(true),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
