import { Injectable, Logger } from '@nestjs/common';
import { JobsRegistry } from '../jobs/jobs.registry';
import { AuditEntry } from './audit-log.schema';
import { AUDIT_LOG_JOB } from './audit-log.worker';

/**
 * Publishes wallet audit events to the audit-log worker. Publishing never fails the
 * business operation that triggered it; the event id makes retries idempotent.
 */
@Injectable()
export class AuditPublisher {
  private readonly logger = new Logger(AuditPublisher.name);

  constructor(private readonly jobs: JobsRegistry) {}

  async publish(entries: AuditEntry[]): Promise<void> {
    const occurredAt = new Date().toISOString();
    await Promise.all(
      entries.map((entry) =>
        this.jobs
          .enqueue(
            AUDIT_LOG_JOB,
            { ...entry, occurred_at: entry.occurred_at ?? occurredAt },
            { jobId: auditJobId(entry) },
          )
          .catch((error: Error) =>
            this.logger.warn(`Could not enqueue audit event ${entry.event}: ${error.message}`),
          ),
      ),
    );
  }
}

export function auditJobId(entry: AuditEntry): string {
  return ['audit', entry.wallet_id, entry.event, entry.transaction_id ?? 'none'].join('-');
}
