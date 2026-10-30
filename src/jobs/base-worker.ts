import { SetMetadata } from '@nestjs/common';
import type { Job, JobsOptions, RepeatOptions } from 'bullmq';

export const JOB_WORKER = 'yapa:job-worker';

/**
 * Registers a class as a background worker. Adding a worker is:
 *   1. extend BaseWorker and decorate it with @JobWorker('name'),
 *   2. list it in a module's providers.
 * The JobsRegistry discovers it, creates its queue and worker, schedules it if it
 * declares a repeat, and exposes it to the admin trigger endpoint.
 */
export const JobWorker = (name: string): ClassDecorator => SetMetadata(JOB_WORKER, name);

export type WorkerSchedule = Pick<RepeatOptions, 'every' | 'pattern'>;

export abstract class BaseWorker<TPayload = unknown, TResult = unknown> {
  /** Human-readable description shown by GET /admin/jobs. */
  abstract readonly description: string;

  /** Parallel jobs per process. */
  readonly concurrency: number = 1;

  /** Defaults applied to every job enqueued on this worker's queue. */
  readonly jobOptions: JobsOptions = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };

  /** Return a schedule to run this worker repeatedly; undefined means on-demand only. */
  schedule(): WorkerSchedule | undefined {
    return undefined;
  }

  abstract process(payload: TPayload, job?: Job<TPayload>): Promise<TResult>;
}
