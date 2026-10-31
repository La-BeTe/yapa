import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppError, ErrorCode } from '../common/http/app-error';
import { isUlid } from '../common/ids/ulid';
import { AppConfigService } from '../config/app-config.service';
import { WalletsService } from '../wallets/wallets.service';
import { TRANSACTION_LIST_CACHE, type TransactionListCache } from './transaction-list.cache';
import { directionFor, presentTransaction } from './transaction.presenter';
import type { TransactionFinalizedHook } from './transaction.executor';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRecord,
  type TransactionRepository,
} from './transaction.types';
import type { ListTransactionsQuery } from './transactions.dto';

const DEFAULT_LIMIT = 20;

export type HistoryFilters = Omit<ListTransactionsQuery, 'wallet_id'>;

export interface TransactionPage {
  items: Array<ReturnType<typeof presentTransaction> & { direction: string }>;
  next_cursor: string | null;
  limit: number;
}

/** Wallet transaction history: newest first, cursor-paginated, cached in Redis. */
@Injectable()
export class TransactionHistoryService implements TransactionFinalizedHook {
  private readonly logger = new Logger(TransactionHistoryService.name);

  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(TRANSACTION_LIST_CACHE) private readonly cache: TransactionListCache,
    private readonly wallets: WalletsService,
    private readonly config: AppConfigService,
  ) {}

  async list(walletId: string, query: HistoryFilters): Promise<TransactionPage> {
    if (query.cursor !== undefined && !isUlid(query.cursor)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'cursor is invalid', HttpStatus.BAD_REQUEST);
    }
    await this.wallets.get(walletId);
    const limit = query.limit ?? DEFAULT_LIMIT;

    const key = await this.cacheKey(walletId, { ...query, limit });
    const cached = key ? await this.cache.get(key).catch(() => null) : null;
    if (cached) {
      return JSON.parse(cached) as TransactionPage;
    }

    const rows = await this.transactions.list({
      walletId,
      type: query.type,
      currency: query.currency,
      before: query.cursor?.toUpperCase(),
      limit: limit + 1,
    });
    const page = toPage(rows, walletId, limit);

    if (key) {
      await this.cache
        .set(key, JSON.stringify(page), this.config.get('TX_LIST_CACHE_TTL_SECONDS'))
        .catch((error: Error) =>
          this.logger.warn(`Could not cache history page: ${error.message}`),
        );
    }
    return page;
  }

  /** Invalidates cached history for every wallet touched by a finalized transaction. */
  async onFinalized(transaction: TransactionRecord): Promise<void> {
    const walletIds = [transaction.source.wallet_id, transaction.destination.wallet_id].filter(
      (id): id is string => id !== null,
    );
    await this.cache.bump(walletIds);
  }

  private async cacheKey(walletId: string, query: HistoryFilters): Promise<string | null> {
    try {
      const version = await this.cache.version(walletId);
      const fingerprint = createHash('sha1')
        .update(
          JSON.stringify([
            query.type ?? null,
            query.currency ?? null,
            query.limit,
            query.cursor ?? null,
          ]),
        )
        .digest('hex');
      return `tx:list:${walletId}:v${version}:${fingerprint}`;
    } catch (error) {
      this.logger.warn(`History cache unavailable: ${(error as Error).message}`);
      return null;
    }
  }
}

function toPage(rows: TransactionRecord[], walletId: string, limit: number): TransactionPage {
  const items = rows.slice(0, limit);
  return {
    items: items.map((tx) => ({
      ...presentTransaction(tx),
      direction: directionFor(tx, walletId),
    })),
    next_cursor: rows.length > limit ? items.at(-1)!._id : null,
    limit,
  };
}
