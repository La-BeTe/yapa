import { HttpStatus, Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  type Account,
  AccountFlags,
  type Client,
  CreateAccountStatus,
  CreateTransferStatus,
  type Transfer,
  TransferFlags,
} from 'tigerbeetle-node';
import { AppError, ErrorCode } from '../common/http/app-error';
import { bigIntToUlid, ulidToBigInt } from '../common/ids/ulid';
import { AccountCode, TIGERBEETLE_CLIENT, TransferCode } from './ledger.constants';

export interface LedgerAccountSpec {
  /** ULID of the matching `accounts` document; used verbatim as the TigerBeetle id. */
  id: string;
  ledger: number;
  code: AccountCode;
  /** User accounts may never be overdrawn; operator accounts are unbounded. */
  preventOverdraft: boolean;
}

export interface LedgerTransferSpec {
  id: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: bigint;
  ledger: number;
  code: TransferCode;
  /** ULID of the business transaction this leg belongs to. */
  transactionId: string;
}

export type LedgerFailure = 'INSUFFICIENT_FUNDS' | 'ALREADY_FAILED' | 'REJECTED';

export type SubmitResult =
  { ok: true } | { ok: false; failure: LedgerFailure; status: string; index: number };

const OK_TRANSFER = new Set([CreateTransferStatus.created, CreateTransferStatus.exists]);
const OK_ACCOUNT = new Set([CreateAccountStatus.created, CreateAccountStatus.exists]);

/**
 * Thin domain wrapper over the TigerBeetle client. TigerBeetle is the source of truth for
 * balances: it applies transfers serially, enforces no-overdraft on user accounts, and
 * deduplicates by transfer id, which gives us idempotent, race-free money movement.
 */
@Injectable()
export class LedgerService implements OnApplicationShutdown {
  constructor(@Inject(TIGERBEETLE_CLIENT) private readonly client: Client) {}

  async createAccounts(specs: LedgerAccountSpec[]): Promise<void> {
    if (specs.length === 0) {
      return;
    }
    const results = await this.client.createAccounts(specs.map(toAccount));
    results.forEach((result, index) => {
      if (!OK_ACCOUNT.has(result.status)) {
        throw ledgerError(
          `Failed to create ledger account ${specs[index]?.id}: ${CreateAccountStatus[result.status]}`,
        );
      }
    });
  }

  /**
   * Submits all legs as one linked chain: either every leg is applied or none is.
   * Resubmitting the same ids is safe (`exists`), which lets interrupted operations resume.
   */
  async submitTransfers(specs: LedgerTransferSpec[]): Promise<SubmitResult> {
    if (specs.length === 0) {
      throw new Error('submitTransfers requires at least one transfer');
    }
    const batch = specs.map((spec, index) => toTransfer(spec, index < specs.length - 1));
    const results = await this.client.createTransfers(batch);

    for (const [index, result] of results.entries()) {
      if (
        OK_TRANSFER.has(result.status) ||
        result.status === CreateTransferStatus.linked_event_failed
      ) {
        continue;
      }
      const status = CreateTransferStatus[result.status];
      if (status.startsWith('exists_with_different')) {
        // Same id, different payload: the stored transaction and the ledger disagree.
        throw ledgerError(
          `Ledger transfer ${specs[index]?.id} conflicts with an existing one: ${status}`,
        );
      }
      return { ok: false, failure: classify(result.status), status, index };
    }

    if (results.some((r) => !OK_TRANSFER.has(r.status))) {
      throw ledgerError('Linked chain failed without a root cause');
    }
    return { ok: true };
  }

  /** Returns the ids (as ULIDs) of the transfers that exist in the ledger. */
  async findExistingTransfers(ids: string[]): Promise<Set<string>> {
    const found = await this.client.lookupTransfers(ids.map(ulidToBigInt));
    return new Set(found.map((transfer) => bigIntToUlid(transfer.id)));
  }

  /** Posted balance (credits − debits) per account id, in minor units. */
  async getBalances(accountIds: string[]): Promise<Map<string, bigint>> {
    const accounts = await this.client.lookupAccounts(accountIds.map(ulidToBigInt));
    const byId = new Map<bigint, Account>(accounts.map((account) => [account.id, account]));
    const balances = new Map<string, bigint>();
    for (const id of accountIds) {
      const account = byId.get(ulidToBigInt(id));
      if (account) {
        balances.set(id, account.credits_posted - account.debits_posted);
      }
    }
    return balances;
  }

  /** Returns the ids (as ULIDs) of the accounts that exist in the ledger. */
  async findExistingAccounts(ids: string[]): Promise<Set<string>> {
    const found = await this.client.lookupAccounts(ids.map(ulidToBigInt));
    return new Set(found.map((account) => bigIntToUlid(account.id)));
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}

function classify(status: CreateTransferStatus): LedgerFailure {
  switch (status) {
    case CreateTransferStatus.exceeds_credits:
      return 'INSUFFICIENT_FUNDS';
    case CreateTransferStatus.id_already_failed:
      return 'ALREADY_FAILED';
    default:
      return 'REJECTED';
  }
}

function ledgerError(message: string): AppError {
  return new AppError(ErrorCode.LEDGER_ERROR, message, HttpStatus.INTERNAL_SERVER_ERROR);
}

function toAccount(spec: LedgerAccountSpec): Account {
  return {
    id: ulidToBigInt(spec.id),
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: spec.ledger,
    code: spec.code,
    flags: spec.preventOverdraft ? AccountFlags.debits_must_not_exceed_credits : AccountFlags.none,
    timestamp: 0n,
  };
}

function toTransfer(spec: LedgerTransferSpec, linked: boolean): Transfer {
  return {
    id: ulidToBigInt(spec.id),
    debit_account_id: ulidToBigInt(spec.debitAccountId),
    credit_account_id: ulidToBigInt(spec.creditAccountId),
    amount: spec.amount,
    pending_id: 0n,
    user_data_128: ulidToBigInt(spec.transactionId),
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: spec.ledger,
    code: spec.code,
    flags: linked ? TransferFlags.linked : TransferFlags.none,
    timestamp: 0n,
  };
}
