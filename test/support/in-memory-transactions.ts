import {
  DuplicateReferenceError,
  type Finalization,
  type ListFilter,
  type NewTransaction,
  type TransactionRecord,
  type TransactionRepository,
} from '../../src/transactions/transaction.types';

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory TransactionRepository mirroring the Mongo implementation's semantics. */
export class InMemoryTransactionRepository implements TransactionRepository {
  readonly rows = new Map<string, TransactionRecord>();

  insert(transaction: NewTransaction): Promise<TransactionRecord> {
    for (const row of this.rows.values()) {
      if (row.unique_reference === transaction.unique_reference) {
        return Promise.reject(new DuplicateReferenceError(transaction.unique_reference));
      }
    }
    const now = new Date();
    const record: TransactionRecord = { ...clone(transaction), created_at: now, updated_at: now };
    this.rows.set(record._id, record);
    return Promise.resolve(clone(record));
  }

  findById(id: string) {
    const row = this.rows.get(id);
    return Promise.resolve(row ? clone(row) : null);
  }

  findByReference(reference: string) {
    const row = [...this.rows.values()].find((r) => r.unique_reference === reference);
    return Promise.resolve(row ? clone(row) : null);
  }

  finalize(id: string, finalization: Finalization) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'PENDING') {
      return Promise.resolve(null);
    }
    const updated: TransactionRecord = { ...row, ...clone(finalization), updated_at: new Date() };
    this.rows.set(id, updated);
    return Promise.resolve(clone(updated));
  }

  findStalePending(olderThan: Date, limit: number) {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((r) => r.status === 'PENDING' && r.updated_at < olderThan)
        .slice(0, limit)
        .map(clone),
    );
  }

  list({ walletId, type, currency, before, limit }: ListFilter) {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((r) => r.source.wallet_id === walletId || r.destination.wallet_id === walletId)
        .filter((r) => !type || r.type === type)
        .filter(
          (r) => !currency || r.source.currency === currency || r.destination.currency === currency,
        )
        .filter((r) => !before || r._id < before)
        .sort((a, b) => (a._id < b._id ? 1 : -1))
        .slice(0, limit)
        .map(clone),
    );
  }

  /** Test helper: make a pending transaction look abandoned. */
  age(id: string, ms: number) {
    const row = this.rows.get(id)!;
    row.updated_at = new Date(row.updated_at.getTime() - ms);
  }
}

export class InMemoryTransactionListCache {
  readonly versions = new Map<string, number>();
  readonly entries = new Map<string, string>();
  failing = false;

  private check() {
    return this.failing ? Promise.reject(new Error('redis down')) : Promise.resolve();
  }

  async version(walletId: string) {
    await this.check();
    return this.versions.get(walletId) ?? 0;
  }

  async get(key: string) {
    await this.check();
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: string) {
    await this.check();
    this.entries.set(key, value);
  }

  async bump(walletIds: string[]) {
    await this.check();
    for (const id of new Set(walletIds)) {
      this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    }
  }
}
