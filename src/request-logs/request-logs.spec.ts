import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppError, ErrorCode } from '../common/http/app-error';
import { configureApp } from '../common/http/configure-app';
import { RequestIdMiddleware } from '../common/http/request-id.middleware';
import { JobsRegistry } from '../jobs/jobs.registry';
import { RequestLogMiddleware } from './request-log.middleware';
import type { RequestLogEntry } from './request-log.schema';
import { MAX_LOGGED_BODY_BYTES, REDACTED, redactHeaders, truncateBody } from './sanitize';

describe('sanitize', () => {
  it('redacts sensitive headers case-insensitively', () => {
    expect(
      redactHeaders({ Authorization: 'Bearer x', 'x-admin-key': 'k', cookie: 'c', accept: 'json' }),
    ).toEqual({
      Authorization: REDACTED,
      'x-admin-key': REDACTED,
      cookie: REDACTED,
      accept: 'json',
    });
  });

  it('keeps small bodies and truncates large ones', () => {
    expect(truncateBody({ a: 1 })).toEqual({ a: 1 });
    expect(truncateBody(undefined)).toBeNull();
    const big = { blob: 'x'.repeat(MAX_LOGGED_BODY_BYTES * 2) };
    const truncated = truncateBody(big) as { truncated: boolean; preview: string };
    expect(truncated.truncated).toBe(true);
    expect(truncated.preview).toHaveLength(MAX_LOGGED_BODY_BYTES);
  });
});

@Controller('things')
class ThingsController {
  @Post()
  create() {
    return { created: true };
  }

  @Get('broken')
  broken() {
    throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, 'nope');
  }
}

describe('RequestLogMiddleware', () => {
  const enqueued: Array<{ name: string; entry: RequestLogEntry; opts: { jobId: string } }> = [];
  const jobs = {
    enqueue: (name: string, entry: RequestLogEntry, opts: { jobId: string }) => {
      enqueued.push({ name, entry, opts });
      return Promise.resolve('1');
    },
  };

  @Module({
    controllers: [ThingsController],
    providers: [RequestLogMiddleware, { provide: JobsRegistry, useValue: jobs }],
  })
  class TestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer.apply(RequestIdMiddleware, RequestLogMiddleware).forRoutes('*');
    }
  }

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  });

  afterAll(() => app.close());

  const waitForLog = async (count: number) => {
    for (let i = 0; i < 50 && enqueued.length < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('logs the request and final response envelope under the request id', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/things?x=1')
      .set('x-admin-key', 'secret')
      .send({ name: 'a' })
      .expect(201);
    await waitForLog(1);

    const { name, entry, opts } = enqueued[0]!;
    expect(name).toBe('request-log');
    expect(opts.jobId).toBe(`request-log-${res.headers['x-request-id']}`);
    expect(entry).toMatchObject({
      request_id: res.headers['x-request-id'],
      method: 'POST',
      path: '/v1/things',
      query: { x: '1' },
      body: { name: 'a' },
      response_status: 201,
      response_body: { status: 'success', message: 'OK', data: { created: true } },
    });
    expect(entry.headers['x-admin-key']).toBe(REDACTED);
    expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('skips health probes', async () => {
    const before = enqueued.length;
    await request(app.getHttpServer()).get('/v1/health');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(enqueued).toHaveLength(before);
  });

  it('logs error responses produced by the exception filter', async () => {
    await request(app.getHttpServer()).get('/v1/things/broken').expect(422);
    await waitForLog(2);
    expect(enqueued[1]!.entry).toMatchObject({
      response_status: 422,
      response_body: { status: 'error', data: { code: 'INSUFFICIENT_FUNDS' } },
    });
  });
});
