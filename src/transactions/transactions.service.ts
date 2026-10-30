import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { OperatorAccountsService } from '../accounts/operator-accounts.service';
import { AppError, ErrorCode } from '../common/http/app-error';
import { newId } from '../common/ids/ulid';
import { CURRENCIES } from '../common/money/currency';
import { convert } from '../common/money/money';
import { AppConfigService } from '../config/app-config.service';
import { FxRateService } from '../fx/fx-rate.service';
import { TransferCode } from '../ledger/ledger.constants';
import { WalletsService } from '../wallets/wallets.service';
import { commandHash, toCommand, type TransactionCommand } from './transaction-command';
import { TransactionExecutor } from './transaction.executor';
import {
  DuplicateReferenceError,
  type LedgerLeg,
  type StoredResponse,
  TRANSACTION_REPOSITORY,
  type TransactionFx,
  type TransactionRecord,
  type TransactionRepository,
} from './transaction.types';
import type { CreateTransactionDto } from './transactions.dto';

const TYPE_CODES = {
  DEPOSIT: TransferCode.DEPOSIT,
  SWAP: TransferCode.SWAP,
  TRANSFER: TransferCode.TRANSFER,
} as const;

/**
 * Entry point for every money movement. The flow is:
 *   1. validate and normalise the request into a command,
 *   2. idempotency: a known unique_reference replays its stored response,
 *   3. quote FX, compute amounts and the ledger legs (with pre-generated ids),
 *   4. persist the transaction as PENDING (the unique index settles concurrent duplicates),
 *   5. execute it against TigerBeetle and finalize.
 */
@Injectable()
export class TransactionsService {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    private readonly executor: TransactionExecutor,
    private readonly wallets: WalletsService,
    private readonly operators: OperatorAccountsService,
    private readonly fx: FxRateService,
    private readonly config: AppConfigService,
  ) {}

  async create(dto: CreateTransactionDto, requestId?: string): Promise<StoredResponse> {
    const command = toCommand(dto);
    const hash = commandHash(command);

    const existing = await this.transactions.findByReference(command.reference);
    if (existing) {
      return this.replay(existing, hash);
    }

    const draft = await this.prepare(command, hash, requestId ?? null);
    let pending: TransactionRecord;
    try {
      pending = await this.transactions.insert(draft);
    } catch (error) {
      if (error instanceof DuplicateReferenceError) {
        // Lost a race with an identical concurrent request.
        return this.replay((await this.transactions.findByReference(command.reference))!, hash);
      }
      throw error;
    }

    return responseOf(await this.executor.execute(pending));
  }

  async get(id: string): Promise<TransactionRecord> {
    const transaction = await this.transactions.findById(id);
    if (!transaction) {
      throw AppError.notFound(ErrorCode.TRANSACTION_NOT_FOUND, `Transaction ${id} was not found`);
    }
    return transaction;
  }

  private async replay(existing: TransactionRecord, hash: string): Promise<StoredResponse> {
    if (existing.request_hash !== hash) {
      throw new AppError(
        ErrorCode.UNIQUE_REFERENCE_REUSED,
        'unique_reference was already used for a different request',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { transaction_id: existing._id },
      );
    }
    if (existing.status !== 'PENDING') {
      return responseOf(existing);
    }
    const staleAfter = this.config.get('RECONCILER_STALE_AFTER_MS');
    if (Date.now() - new Date(existing.updated_at).getTime() < staleAfter) {
      throw AppError.conflict(
        ErrorCode.TRANSACTION_IN_PROGRESS,
        'A request with this unique_reference is still being processed',
      );
    }
    // The original attempt stopped before finalizing; resume it with the stored legs.
    return responseOf(await this.executor.execute(existing));
  }

  private async prepare(command: TransactionCommand, hash: string, requestId: string | null) {
    const [source, destination] = await Promise.all([
      command.sourceWalletId ? this.wallets.getActive(command.sourceWalletId) : null,
      this.wallets.getActive(command.destinationWalletId),
    ]);
    const sourceAccounts = source ? await this.wallets.accountIds(source._id) : null;
    const destinationAccounts =
      destination._id === source?._id
        ? sourceAccounts!
        : await this.wallets.accountIds(destination._id);

    const transactionId = newId();
    const code = TYPE_CODES[command.type];
    const from = command.sourceCurrency;
    const to = command.destinationCurrency;
    const legs: LedgerLeg[] = [];
    let destinationAmount = command.amount;
    let fx: TransactionFx | null = null;

    const leg = (
      debit: string,
      credit: string,
      amount: bigint,
      currency: typeof from,
      legCode: TransferCode,
    ) =>
      legs.push({
        id: newId(),
        debit_account_id: debit,
        credit_account_id: credit,
        amount: amount.toString(),
        ledger: CURRENCIES[currency].ledger,
        code: legCode,
      });

    if (command.type === 'DEPOSIT') {
      leg(
        await this.operators.getId('TREASURY', to),
        destinationAccounts[to],
        command.amount,
        to,
        code,
      );
    } else if (from === to) {
      leg(sourceAccounts![from], destinationAccounts[to], command.amount, from, code);
    } else {
      const quote = await this.fx.quote(from, to);
      const { net, fee } = convert({
        amount: command.amount,
        fromScale: CURRENCIES[from].scale,
        toScale: CURRENCIES[to].scale,
        midRate: quote.mid_rate,
        spreadBps: quote.spread_bps,
      });
      destinationAmount = net;
      fx = {
        mid_rate: quote.mid_rate,
        effective_rate: quote.effective_rate,
        spread_bps: quote.spread_bps,
        fee_amount: fee.toString(),
        rate_source: quote.source,
        rate_refreshed_at: quote.refreshed_at,
      };
      const [poolFrom, poolTo, feeTo] = await Promise.all([
        this.operators.getId('FX_POOL', from),
        this.operators.getId('FX_POOL', to),
        this.operators.getId('FEE', to),
      ]);
      // The user pays into the source-currency pool, the destination-currency pool pays the
      // user the net amount and the fee account the spread. All legs apply atomically.
      leg(sourceAccounts![from], poolFrom, command.amount, from, code);
      leg(poolTo, destinationAccounts[to], net, to, code);
      if (fee > 0n) {
        leg(poolTo, feeTo, fee, to, TransferCode.FX_FEE);
      }
    }

    return {
      _id: transactionId,
      type: command.type,
      status: 'PENDING' as const,
      unique_reference: command.reference,
      request_hash: hash,
      source: {
        wallet_id: command.sourceWalletId,
        amount: command.amount.toString(),
        currency: from,
      },
      destination: {
        wallet_id: command.destinationWalletId,
        amount: destinationAmount.toString(),
        currency: to,
      },
      fx,
      ledger_transfers: legs,
      failure: null,
      response: null,
      request_id: requestId,
      completed_at: null,
    };
  }
}

function responseOf(transaction: TransactionRecord): StoredResponse {
  if (!transaction.response) {
    throw new Error(`Transaction ${transaction._id} has no stored response`);
  }
  return transaction.response;
}
