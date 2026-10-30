import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditPublisher } from '../audit/audit.publisher';
import type { AuditEntry } from '../audit/audit-log.schema';
import { AppError, ErrorCode } from '../common/http/app-error';
import { failure, success } from '../common/http/envelope';
import { LedgerService, type SubmitResult } from '../ledger/ledger.service';
import { presentTransaction } from './transaction.presenter';
import {
  Finalization,
  TRANSACTION_REPOSITORY,
  type TransactionRecord,
  type TransactionRepository,
} from './transaction.types';

export const TRANSACTION_FINALIZED_HOOKS = Symbol('TRANSACTION_FINALIZED_HOOKS');

/** Side effects to run once a transaction reaches a final state (cache invalidation, ...). */
export interface TransactionFinalizedHook {
  onFinalized(transaction: TransactionRecord): Promise<void>;
}

/**
 * Moves a PENDING transaction to its final state: submits its stored ledger legs as one
 * linked chain, then records the outcome and the response replayed to retries.
 * Because the legs and their ids are stored before submission, calling this again for the
 * same transaction (client retry or reconciler) can never move money twice.
 */
@Injectable()
export class TransactionExecutor {
  private readonly logger = new Logger(TransactionExecutor.name);

  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    private readonly ledger: LedgerService,
    private readonly audit: AuditPublisher,
    @Inject(TRANSACTION_FINALIZED_HOOKS) private readonly hooks: TransactionFinalizedHook[],
  ) {}

  async execute(transaction: TransactionRecord): Promise<TransactionRecord> {
    if (transaction.status !== 'PENDING') {
      return transaction;
    }

    let result: SubmitResult;
    try {
      result = await this.ledger.submitTransfers(
        transaction.ledger_transfers.map((leg) => ({
          id: leg.id,
          debitAccountId: leg.debit_account_id,
          creditAccountId: leg.credit_account_id,
          amount: BigInt(leg.amount),
          ledger: leg.ledger,
          code: leg.code,
          transactionId: transaction._id,
        })),
      );
    } catch (error) {
      this.logger.error(
        `Ledger submission failed for ${transaction._id}: ${(error as Error).message}`,
      );
      throw new AppError(
        ErrorCode.TRANSACTION_PENDING,
        'The transaction could not be confirmed yet; retry with the same unique_reference',
        HttpStatus.SERVICE_UNAVAILABLE,
        { transaction_id: transaction._id },
      );
    }

    const finalized = await this.transactions.finalize(
      transaction._id,
      finalization(transaction, result),
    );
    if (!finalized) {
      // Someone else (a concurrent retry or the reconciler) finalized it first.
      return (await this.transactions.findById(transaction._id))!;
    }

    await this.audit.publish(auditEntries(finalized));
    await Promise.all(
      this.hooks.map((hook) =>
        hook
          .onFinalized(finalized)
          .catch((error: Error) =>
            this.logger.warn(`Finalization hook failed for ${finalized._id}: ${error.message}`),
          ),
      ),
    );
    return finalized;
  }
}

function finalization(transaction: TransactionRecord, result: SubmitResult): Finalization {
  const completedAt = new Date();
  if (result.ok) {
    const completed: TransactionRecord = {
      ...transaction,
      status: 'COMPLETED',
      completed_at: completedAt,
    };
    return {
      status: 'COMPLETED',
      failure: null,
      completed_at: completedAt,
      response: {
        http_status: HttpStatus.CREATED,
        body: success('Transaction completed', presentTransaction(completed)),
      },
    };
  }

  const reason =
    result.failure === 'INSUFFICIENT_FUNDS'
      ? {
          code: ErrorCode.INSUFFICIENT_FUNDS,
          message: `Insufficient ${transaction.source.currency} balance`,
        }
      : {
          code: ErrorCode.TRANSACTION_REJECTED,
          message: `The ledger rejected the transaction (${result.status})`,
        };
  return {
    status: 'FAILED',
    failure: reason,
    completed_at: completedAt,
    response: {
      http_status: HttpStatus.UNPROCESSABLE_ENTITY,
      body: failure(reason.code, reason.message, { transaction_id: transaction._id }),
    },
  };
}

function auditEntries(tx: TransactionRecord): AuditEntry[] {
  const base = { transaction_id: tx._id, request_id: tx.request_id };
  const metadata = { source: tx.source, destination: tx.destination, fx: tx.fx };
  const initiator = tx.source.wallet_id ?? tx.destination.wallet_id!;

  if (tx.status === 'FAILED') {
    return [
      {
        ...base,
        wallet_id: initiator,
        event: 'TRANSACTION_FAILED',
        metadata: { ...metadata, failure: tx.failure },
      },
    ];
  }
  switch (tx.type) {
    case 'DEPOSIT':
      return [
        { ...base, wallet_id: tx.destination.wallet_id!, event: 'DEPOSIT_COMPLETED', metadata },
      ];
    case 'SWAP':
      return [{ ...base, wallet_id: initiator, event: 'SWAP_COMPLETED', metadata }];
    case 'TRANSFER':
      return [
        { ...base, wallet_id: tx.source.wallet_id!, event: 'TRANSFER_SENT', metadata },
        { ...base, wallet_id: tx.destination.wallet_id!, event: 'TRANSFER_RECEIVED', metadata },
      ];
  }
}
