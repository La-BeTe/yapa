import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseWorker, JobWorker } from '../jobs/base-worker';
import { AuditEntry, AuditLog } from './audit-log.schema';
import { isDuplicateKeyError } from '../database/mongo-errors';

export const AUDIT_LOG_JOB = 'audit-log';
@Injectable()
@JobWorker(AUDIT_LOG_JOB)
export class AuditLogWorker extends BaseWorker<AuditEntry> {
  readonly description = 'Persists wallet audit events';
  override readonly concurrency = 10;

  constructor(@InjectModel(AuditLog.name) private readonly logs: Model<AuditLog>) {
    super();
  }

  async process(entry: AuditEntry): Promise<void> {
    try {
      await this.logs.create({
        wallet_id: entry.wallet_id,
        event: entry.event,
        transaction_id: entry.transaction_id ?? null,
        request_id: entry.request_id ?? null,
        metadata: entry.metadata ?? {},
        occurred_at: entry.occurred_at ? new Date(entry.occurred_at) : new Date(),
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }
}
