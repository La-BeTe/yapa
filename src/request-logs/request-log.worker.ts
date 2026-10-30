import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseWorker, JobWorker } from '../jobs/base-worker';
import { RequestLog, RequestLogEntry } from './request-log.schema';
import { isDuplicateKeyError } from '../database/mongo-errors';

export const REQUEST_LOG_JOB = 'request-log';
@Injectable()
@JobWorker(REQUEST_LOG_JOB)
export class RequestLogWorker extends BaseWorker<RequestLogEntry> {
  readonly description = 'Persists HTTP request/response logs';
  override readonly concurrency = 10;

  constructor(@InjectModel(RequestLog.name) private readonly logs: Model<RequestLog>) {
    super();
  }

  async process(entry: RequestLogEntry): Promise<void> {
    try {
      await this.logs.create({ ...entry, occurred_at: new Date(entry.occurred_at) });
    } catch (error) {
      // A retried job whose first attempt already wrote the log.
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }
}
