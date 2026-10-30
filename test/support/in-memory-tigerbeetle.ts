import {
  Account,
  AccountFlags,
  Client,
  CreateAccountResult,
  CreateAccountStatus,
  CreateTransferResult,
  CreateTransferStatus,
  Transfer,
  TransferFlags,
} from 'tigerbeetle-node';

/**
 * Minimal in-memory stand-in for a TigerBeetle cluster, faithful to the semantics YAPA relies
 * on: per-event results, linked chains that apply atomically, `exists` deduplication,
 * `id_already_failed`, ledger matching and the no-overdraft account flag.
 * Integration tests run against real TigerBeetle; this keeps unit tests fast.
 */
export class InMemoryTigerBeetle implements Pick<
  Client,
  'createAccounts' | 'createTransfers' | 'lookupAccounts' | 'lookupTransfers' | 'destroy'
> {
  readonly accounts = new Map<bigint, Account>();
  readonly transfers = new Map<bigint, Transfer>();
  readonly failedIds = new Set<bigint>();
  private clock = 1n;

  createAccounts(batch: Account[]): Promise<CreateAccountResult[]> {
    return Promise.resolve(
      batch.map((account) => {
        const existing = this.accounts.get(account.id);
        if (existing) {
          const status =
            existing.ledger !== account.ledger
              ? CreateAccountStatus.exists_with_different_ledger
              : existing.code !== account.code
                ? CreateAccountStatus.exists_with_different_code
                : existing.flags !== account.flags
                  ? CreateAccountStatus.exists_with_different_flags
                  : CreateAccountStatus.exists;
          return { timestamp: 0n, status };
        }
        this.accounts.set(account.id, { ...account, timestamp: this.clock++ });
        return { timestamp: this.clock, status: CreateAccountStatus.created };
      }),
    );
  }

  createTransfers(batch: Transfer[]): Promise<CreateTransferResult[]> {
    const results: CreateTransferResult[] = [];
    let chain: Transfer[] = [];
    for (const transfer of batch) {
      chain.push(transfer);
      if ((transfer.flags & TransferFlags.linked) === 0) {
        results.push(...this.applyChain(chain));
        chain = [];
      }
    }
    if (chain.length > 0) {
      results.push(
        ...chain.map(() => ({
          timestamp: 0n,
          status: CreateTransferStatus.linked_event_chain_open,
        })),
      );
    }
    return Promise.resolve(results);
  }

  lookupAccounts(ids: bigint[]): Promise<Account[]> {
    return Promise.resolve(
      ids.flatMap((id) => {
        const account = this.accounts.get(id);
        return account ? [{ ...account }] : [];
      }),
    );
  }

  lookupTransfers(ids: bigint[]): Promise<Transfer[]> {
    return Promise.resolve(
      ids.flatMap((id) => {
        const transfer = this.transfers.get(id);
        return transfer ? [{ ...transfer }] : [];
      }),
    );
  }

  destroy(): void {}

  balanceOf(id: bigint): bigint {
    const account = this.accounts.get(id);
    return account ? account.credits_posted - account.debits_posted : 0n;
  }

  private applyChain(chain: Transfer[]): CreateTransferResult[] {
    const staged = new Map<bigint, Account>();
    const get = (id: bigint) => staged.get(id) ?? this.accounts.get(id);
    const statuses: CreateTransferStatus[] = [];

    for (const transfer of chain) {
      const status = this.validate(transfer, get);
      statuses.push(status);
      if (status !== CreateTransferStatus.created) {
        if (status === CreateTransferStatus.exists) {
          continue;
        }
        break;
      }
      const debit = { ...get(transfer.debit_account_id)! };
      const credit = { ...get(transfer.credit_account_id)! };
      debit.debits_posted += transfer.amount;
      credit.credits_posted += transfer.amount;
      staged.set(debit.id, debit);
      staged.set(credit.id, credit);
    }

    const failedAt = statuses.findIndex(
      (s) => s !== CreateTransferStatus.created && s !== CreateTransferStatus.exists,
    );
    if (failedAt === -1) {
      staged.forEach((account, id) => this.accounts.set(id, account));
      chain.forEach((transfer, index) => {
        if (statuses[index] === CreateTransferStatus.created) {
          this.transfers.set(transfer.id, { ...transfer, timestamp: this.clock++ });
        }
      });
      return statuses.map((status) => ({ timestamp: 0n, status }));
    }

    chain.forEach((transfer) => this.failedIds.add(transfer.id));
    return chain.map((_, index) => ({
      timestamp: 0n,
      status: index === failedAt ? statuses[failedAt]! : CreateTransferStatus.linked_event_failed,
    }));
  }

  private validate(
    transfer: Transfer,
    get: (id: bigint) => Account | undefined,
  ): CreateTransferStatus {
    const existing = this.transfers.get(transfer.id);
    if (existing) {
      if (existing.amount !== transfer.amount) {
        return CreateTransferStatus.exists_with_different_amount;
      }
      if (existing.debit_account_id !== transfer.debit_account_id) {
        return CreateTransferStatus.exists_with_different_debit_account_id;
      }
      if (existing.credit_account_id !== transfer.credit_account_id) {
        return CreateTransferStatus.exists_with_different_credit_account_id;
      }
      return CreateTransferStatus.exists;
    }
    if (this.failedIds.has(transfer.id)) {
      return CreateTransferStatus.id_already_failed;
    }
    if (transfer.debit_account_id === transfer.credit_account_id) {
      return CreateTransferStatus.accounts_must_be_different;
    }
    const debit = get(transfer.debit_account_id);
    const credit = get(transfer.credit_account_id);
    if (!debit) {
      return CreateTransferStatus.debit_account_not_found;
    }
    if (!credit) {
      return CreateTransferStatus.credit_account_not_found;
    }
    if (debit.ledger !== credit.ledger) {
      return CreateTransferStatus.accounts_must_have_the_same_ledger;
    }
    if (transfer.ledger !== debit.ledger) {
      return CreateTransferStatus.transfer_must_have_the_same_ledger_as_accounts;
    }
    if (
      (debit.flags & AccountFlags.debits_must_not_exceed_credits) !== 0 &&
      debit.debits_posted + transfer.amount > debit.credits_posted
    ) {
      return CreateTransferStatus.exceeds_credits;
    }
    return CreateTransferStatus.created;
  }
}
