import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { BaseWorker, JobWorker, WorkerSchedule } from '../jobs/base-worker';
import { FxRateService } from './fx-rate.service';

export const FX_REFRESH_JOB = 'fx-refresh';

/** Keeps the live rate cache warm and the stored (fallback) rates close to the market. */
@Injectable()
@JobWorker(FX_REFRESH_JOB)
export class FxRefreshWorker extends BaseWorker<Record<string, never>, { refreshed_at: string }> {
  readonly description = 'Fetches live FX rates into the cache and fx_rates';

  constructor(
    private readonly fx: FxRateService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  override schedule(): WorkerSchedule {
    // BullMQ runs an `every` scheduler immediately, so rates are fetched on boot too.
    return { every: this.config.get('FX_REFRESH_EVERY_MS') };
  }

  async process(): Promise<{ refreshed_at: string }> {
    const snapshot = await this.fx.refresh();
    return { refreshed_at: snapshot.refreshed_at };
  }
}
