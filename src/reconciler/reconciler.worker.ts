import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditPublisher } from '../audit/audit.publisher';
import { AppConfigService } from '../config/app-config.service';
import { BaseWorker, JobWorker, WorkerSchedule } from '../jobs/base-worker';
import { TransactionExecutor } from '../transactions/transaction.executor';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from '../transactions/transaction.types';
import { WalletsService } from '../wallets/wallets.service';

export const RECONCILER_JOB = 'reconciler';
const BATCH_SIZE = 100;

export interface ReconcileSummary {
  transactions: { finalized: number; still_pending: number };
  wallets: { activated: number; still_provisioning: number };
}

/**
 * Repairs work interrupted between MongoDB and TigerBeetle:
 * - PENDING transactions older than the stale threshold are executed again with their
 *   stored legs; TigerBeetle reports already-applied legs as `exists`, so this finalizes
 *   them without moving money twice,
 * - PROVISIONING wallets get their missing ledger accounts and are activated.
 */
@Injectable()
@JobWorker(RECONCILER_JOB)
export class ReconcilerWorker extends BaseWorker<Record<string, never>, ReconcileSummary> {
  readonly description = 'Finalizes stale pending transactions and provisioning wallets';
  private readonly logger = new Logger(ReconcilerWorker.name);

  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    private readonly executor: TransactionExecutor,
    private readonly wallets: WalletsService,
    private readonly audit: AuditPublisher,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  override schedule(): WorkerSchedule {
    return { every: this.config.get('RECONCILER_EVERY_MS') };
  }

  async process(): Promise<ReconcileSummary> {
    const cutoff = new Date(Date.now() - this.config.get('RECONCILER_STALE_AFTER_MS'));
    const summary: ReconcileSummary = {
      transactions: { finalized: 0, still_pending: 0 },
      wallets: { activated: 0, still_provisioning: 0 },
    };

    for (const pending of await this.transactions.findStalePending(cutoff, BATCH_SIZE)) {
      try {
        const final = await this.executor.execute(pending);
        summary.transactions.finalized++;
        await this.audit.publish([
          {
            wallet_id: final.source.wallet_id ?? final.destination.wallet_id!,
            event: 'TRANSACTION_RECONCILED',
            transaction_id: final._id,
            metadata: { status: final.status },
          },
        ]);
      } catch (error) {
        summary.transactions.still_pending++;
        this.logger.warn(
          `Could not reconcile transaction ${pending._id}: ${(error as Error).message}`,
        );
      }
    }

    for (const wallet of await this.wallets.findStaleProvisioning(cutoff, BATCH_SIZE)) {
      try {
        await this.wallets.activate(wallet._id);
        summary.wallets.activated++;
      } catch (error) {
        summary.wallets.still_provisioning++;
        this.logger.warn(`Could not activate wallet ${wallet._id}: ${(error as Error).message}`);
      }
    }

    if (summary.transactions.finalized + summary.wallets.activated > 0) {
      this.logger.log(`Reconciled ${JSON.stringify(summary)}`);
    }
    return summary;
  }
}
