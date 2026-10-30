import type { CurrencyCode } from '../common/money/currency';
import type { RateSource } from '../fx/fx.types';
import type { TransferCode } from '../ledger/ledger.constants';

export const TRANSACTION_TYPES = ['DEPOSIT', 'SWAP', 'TRANSFER'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['PENDING', 'COMPLETED', 'FAILED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** Amounts are stored as integer strings of minor units to stay exact beyond 2^53. */
export interface TransactionSide {
  wallet_id: string | null;
  amount: string;
  currency: CurrencyCode;
}

export interface TransactionFx {
  mid_rate: string;
  effective_rate: string;
  spread_bps: number;
  /** Spread kept by the platform, in destination-currency minor units. */
  fee_amount: string;
  rate_source: RateSource;
  rate_refreshed_at: string;
}

/** One TigerBeetle transfer; stored so a pending transaction can be resubmitted verbatim. */
export interface LedgerLeg {
  id: string;
  debit_account_id: string;
  credit_account_id: string;
  amount: string;
  ledger: number;
  code: TransferCode;
}

export interface StoredResponse {
  http_status: number;
  body: unknown;
}

export interface TransactionRecord {
  _id: string;
  type: TransactionType;
  status: TransactionStatus;
  unique_reference: string;
  request_hash: string;
  source: TransactionSide;
  destination: TransactionSide;
  fx: TransactionFx | null;
  ledger_transfers: LedgerLeg[];
  failure: { code: string; message: string } | null;
  response: StoredResponse | null;
  request_id: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type NewTransaction = Omit<TransactionRecord, 'created_at' | 'updated_at'>;

export interface Finalization {
  status: Exclude<TransactionStatus, 'PENDING'>;
  failure: TransactionRecord['failure'];
  response: StoredResponse;
  completed_at: Date;
}

export interface ListFilter {
  walletId: string;
  type?: TransactionType;
  currency?: CurrencyCode;
  /** Return transactions strictly older than this id (ULIDs sort by creation time). */
  before?: string;
  limit: number;
}

export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');

export class DuplicateReferenceError extends Error {
  constructor(readonly reference: string) {
    super(`Duplicate unique_reference: ${reference}`);
  }
}

export interface TransactionRepository {
  /** Inserts a new transaction; throws DuplicateReferenceError if the reference exists. */
  insert(transaction: NewTransaction): Promise<TransactionRecord>;
  findById(id: string): Promise<TransactionRecord | null>;
  findByReference(reference: string): Promise<TransactionRecord | null>;
  /** Moves a PENDING transaction to its final state; returns null if it was already final. */
  finalize(id: string, finalization: Finalization): Promise<TransactionRecord | null>;
  findStalePending(olderThan: Date, limit: number): Promise<TransactionRecord[]>;
  list(filter: ListFilter): Promise<TransactionRecord[]>;
}
