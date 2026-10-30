import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/http/configure-app';
import { LIVE_RATE_PROVIDER } from '../../src/fx/fx.types';
import { REDIS } from '../../src/redis/redis.constants';
import { StubRateProvider } from '../support/in-memory-fx';

let suiteCounter = 0;

export interface E2eApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  provider: StubRateProvider;
  mongo: Connection;
  adminKey: string;
  close(): Promise<void>;
}

/**
 * Boots the real AppModule against the shared containers. Each suite gets its own MongoDB
 * database and Redis logical database so suites (and their BullMQ workers) stay isolated.
 * The live FX provider is replaced by a controllable stub.
 */
export async function createE2eApp(
  suite: string,
  env: Record<string, string> = {},
): Promise<E2eApp> {
  const redisDb = (Number(process.env.JEST_WORKER_ID ?? 1) * 4 + suiteCounter++) % 16;
  const adminKey = 'e2e-admin-key';
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGO_URI: `${process.env.E2E_MONGO_URL}/yapa_${suite}_${Date.now()}`,
    REDIS_URL: `${process.env.E2E_REDIS_URL}/${redisDb}`,
    TB_ADDRESS: process.env.E2E_TB_ADDRESS,
    ADMIN_API_KEY: adminKey,
    RECONCILER_EVERY_MS: '3600000',
    FX_REFRESH_EVERY_MS: '3600000',
    ...env,
  });

  const provider = new StubRateProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LIVE_RATE_PROVIDER)
    .useValue(provider)
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.init();

  const mongo = app.get<Connection>(getConnectionToken());
  await app.get<Redis>(REDIS).flushdb();

  return {
    app,
    http: request(app.getHttpServer()),
    provider,
    mongo,
    adminKey,
    async close() {
      await mongo.dropDatabase();
      await app.close();
    },
  };
}

/** Polls until the assertion passes, for effects produced by background workers. */
export async function eventually<T>(fn: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}
