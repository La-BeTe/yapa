import {
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { JobsOptions, Queue, Worker } from 'bullmq';
import { AppError, ErrorCode } from '../common/http/app-error';
import { AppConfigService } from '../config/app-config.service';
import { BaseWorker, JOB_WORKER, WorkerSchedule } from './base-worker';
import { BullFactory } from './bull-factory';

interface RegisteredWorker {
  name: string;
  instance: BaseWorker;
  queue: Queue;
  worker?: Worker;
  schedule?: WorkerSchedule;
}

export interface WorkerInfo {
  name: string;
  description: string;
  schedule: WorkerSchedule | null;
  concurrency: number;
}

/** Discovers every @JobWorker provider and wires it to BullMQ. */
@Injectable()
export class JobsRegistry implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsRegistry.name);
  private readonly workers = new Map<string, RegisteredWorker>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly bull: BullFactory,
    private readonly config: AppConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const runWorkers = this.config.get('JOBS_ENABLED');

    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      const metatype = wrapper.metatype;
      if (!metatype || !(instance instanceof BaseWorker)) {
        continue;
      }
      const name = this.reflector.get<string | undefined>(JOB_WORKER, metatype);
      if (!name) {
        continue;
      }
      if (this.workers.has(name)) {
        throw new Error(`Duplicate job worker name: ${name}`);
      }

      const queue = this.bull.createQueue(name);
      const registered: RegisteredWorker = { name, instance, queue, schedule: instance.schedule() };
      this.workers.set(name, registered);

      if (runWorkers) {
        registered.worker = this.bull.createWorker(
          name,
          (job) => instance.process(job.data, job),
          instance.concurrency,
        );
        registered.worker.on('failed', (job, error) =>
          this.logger.warn(`${name} job ${job?.id} failed: ${error.message}`),
        );
        if (registered.schedule) {
          await queue.upsertJobScheduler(`${name}-schedule`, registered.schedule, {
            name,
            data: {},
            opts: instance.jobOptions,
          });
        }
      }
    }
    this.logger.log(
      `Registered ${this.workers.size} job worker(s)${runWorkers ? '' : ' (processing disabled)'}`,
    );
  }

  list(): WorkerInfo[] {
    return [...this.workers.values()].map(({ name, instance, schedule }) => ({
      name,
      description: instance.description,
      schedule: schedule ?? null,
      concurrency: instance.concurrency,
    }));
  }

  /**
   * Enqueues a job; returns its id. A custom `jobId` deduplicates identical jobs
   * (BullMQ rejects custom ids that are integers or contain ':').
   */
  async enqueue<T>(name: string, payload: T, opts: JobsOptions = {}): Promise<string> {
    const { queue, instance } = this.get(name);
    const job = await queue.add(name, payload, { ...instance.jobOptions, ...opts });
    return job.id!;
  }

  /** Runs a worker inline, bypassing the queue (used by tests and one-off maintenance). */
  async runNow<T>(name: string, payload: T): Promise<unknown> {
    return this.get(name).instance.process(payload);
  }

  async onApplicationShutdown(): Promise<void> {
    const closing: Promise<void>[] = [];
    for (const { worker, queue } of this.workers.values()) {
      if (worker) {
        closing.push(worker.close());
      }
      closing.push(queue.close());
    }
    await Promise.all(closing);
  }

  private get(name: string): RegisteredWorker {
    const registered = this.workers.get(name);
    if (!registered) {
      throw new AppError(ErrorCode.JOB_NOT_FOUND, `Unknown job: ${name}`, HttpStatus.NOT_FOUND);
    }
    return registered;
  }
}
