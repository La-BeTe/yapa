import { INestApplication, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ADMIN_KEY_HEADER } from '../common/auth/admin-key.guard';
import { configureApp } from '../common/http/configure-app';
import { AppConfigModule } from '../config/config.module';
import { BaseWorker, JobWorker, WorkerSchedule } from './base-worker';
import { BullFactory } from './bull-factory';
import { JobsModule } from './jobs.module';
import { JobsRegistry } from './jobs.registry';

@Injectable()
@JobWorker('echo')
class EchoWorker extends BaseWorker<{ value?: number }> {
  readonly description = 'Echoes its payload';
  readonly seen: unknown[] = [];

  process(payload: { value?: number }) {
    this.seen.push(payload);
    return Promise.resolve(payload);
  }
}

@Injectable()
@JobWorker('ticker')
class TickerWorker extends BaseWorker {
  readonly description = 'Runs on a schedule';
  override readonly concurrency = 3;

  override schedule(): WorkerSchedule {
    return { every: 5000 };
  }

  process() {
    return Promise.resolve();
  }
}

class FakeQueue {
  readonly added: Array<{ name: string; data: unknown; opts: unknown }> = [];
  readonly schedulers: Array<{ id: string; repeat: unknown }> = [];
  add(name: string, data: unknown, opts: unknown) {
    this.added.push({ name, data, opts });
    return Promise.resolve({ id: String(this.added.length) });
  }
  upsertJobScheduler(id: string, repeat: unknown) {
    this.schedulers.push({ id, repeat });
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

class FakeBullFactory {
  readonly queues = new Map<string, FakeQueue>();
  readonly workers = new Map<string, { concurrency: number }>();
  createQueue(name: string) {
    const queue = new FakeQueue();
    this.queues.set(name, queue);
    return queue;
  }
  createWorker(name: string, _processor: unknown, concurrency: number) {
    const worker = { concurrency, on: () => worker, close: () => Promise.resolve() };
    this.workers.set(name, worker);
    return worker;
  }
}

describe('jobs framework', () => {
  // ConfigModule snapshots the environment at import time, so use the default key.
  const adminKey = 'change-me';
  let app: INestApplication;
  let bull: FakeBullFactory;

  beforeAll(async () => {
    bull = new FakeBullFactory();
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, JobsModule],
      providers: [EchoWorker, TickerWorker],
    })
      .overrideProvider(BullFactory)
      .useValue(bull)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  });

  afterAll(() => app.close());

  it('discovers decorated workers and creates a queue and worker for each', () => {
    expect([...bull.queues.keys()].sort()).toEqual(['echo', 'ticker']);
    expect(bull.workers.get('ticker')?.concurrency).toBe(3);
  });

  it('registers schedules only for repeatable workers', () => {
    expect(bull.queues.get('ticker')?.schedulers).toEqual([
      { id: 'ticker:schedule', repeat: { every: 5000 } },
    ]);
    expect(bull.queues.get('echo')?.schedulers).toEqual([]);
  });

  it('runs workers inline', async () => {
    const registry = app.get(JobsRegistry);
    await expect(registry.runNow('echo', { value: 1 })).resolves.toEqual({ value: 1 });
    expect(app.get(EchoWorker).seen).toContainEqual({ value: 1 });
  });

  it('lists registered workers for admins', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/jobs')
      .set(ADMIN_KEY_HEADER, adminKey)
      .expect(200);
    expect(res.body.data).toEqual(
      expect.arrayContaining([
        { name: 'echo', description: 'Echoes its payload', schedule: null, concurrency: 1 },
        {
          name: 'ticker',
          description: 'Runs on a schedule',
          schedule: { every: 5000 },
          concurrency: 3,
        },
      ]),
    );
  });

  it('enqueues a manual run with the given payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/jobs/echo/trigger')
      .set(ADMIN_KEY_HEADER, adminKey)
      .send({ payload: { value: 42 } })
      .expect(202);
    expect(res.body).toMatchObject({
      status: 'success',
      data: { name: 'echo', job_id: expect.any(String) },
    });
    expect(bull.queues.get('echo')?.added.at(-1)).toMatchObject({
      name: 'echo',
      data: { value: 42 },
    });
  });

  it('returns 404 for unknown jobs', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/jobs/nope/trigger')
      .set(ADMIN_KEY_HEADER, adminKey)
      .send({})
      .expect(404);
    expect(res.body.data.code).toBe('JOB_NOT_FOUND');
  });

  it('rejects requests without the admin key', async () => {
    const res = await request(app.getHttpServer()).get('/v1/admin/jobs').expect(401);
    expect(res.body.data.code).toBe('UNAUTHORIZED');
    await request(app.getHttpServer())
      .get('/v1/admin/jobs')
      .set(ADMIN_KEY_HEADER, 'wrong')
      .expect(401);
  });
});
