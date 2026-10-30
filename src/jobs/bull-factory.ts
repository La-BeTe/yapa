import { Injectable } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { AppConfigService } from '../config/app-config.service';

export const QUEUE_PREFIX = 'yapa';

/** Builds BullMQ queues and workers; isolated so the registry can be unit-tested without Redis. */
@Injectable()
export class BullFactory {
  constructor(private readonly config: AppConfigService) {}

  private connection() {
    // BullMQ needs blocking connections that never give up on a request.
    return { url: this.config.get('REDIS_URL'), maxRetriesPerRequest: null };
  }

  createQueue(name: string): Queue {
    return new Queue(name, { connection: this.connection(), prefix: QUEUE_PREFIX });
  }

  createWorker(
    name: string,
    processor: (job: Job) => Promise<unknown>,
    concurrency: number,
  ): Worker {
    return new Worker(name, processor, {
      connection: this.connection(),
      prefix: QUEUE_PREFIX,
      concurrency,
    });
  }
}
