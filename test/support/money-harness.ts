import type { OperatorAccountType } from '../../src/accounts/account.schema';
import type { OperatorAccountsService } from '../../src/accounts/operator-accounts.service';
import type { AuditEntry } from '../../src/audit/audit-log.schema';
import type { AuditPublisher } from '../../src/audit/audit.publisher';
import { AppError, ErrorCode } from '../../src/common/http/app-error';
import { newId, ulidToBigInt } from '../../src/common/ids/ulid';
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from '../../src/common/money/currency';
import type { AppConfigService } from '../../src/config/app-config.service';
import { validateEnv } from '../../src/config/env.schema';
import { FxRateService } from '../../src/fx/fx-rate.service';
import { AccountCode } from '../../src/ledger/ledger.constants';
import { LedgerService } from '../../src/ledger/ledger.service';
import {
  TransactionExecutor,
  type TransactionFinalizedHook,
} from '../../src/transactions/transaction.executor';
import { TransactionHistoryService } from '../../src/transactions/transaction-history.service';
import { TransactionsService } from '../../src/transactions/transactions.service';
import type { WalletRecord, WalletsService } from '../../src/wallets/wallets.service';
import { InMemoryTigerBeetle } from './in-memory-tigerbeetle';
import { InMemoryLiveRateCache, InMemoryRateStore, StubRateProvider } from './in-memory-fx';
import {
  InMemoryTransactionListCache,
  InMemoryTransactionRepository,
} from './in-memory-transactions';

const OPERATOR_CODES: Record<OperatorAccountType, AccountCode> = {
  TREASURY: AccountCode.TREASURY,
  FX_POOL: AccountCode.FX_POOL,
  FEE: AccountCode.FEE,
};

/**
 * Wires the real transaction, ledger and FX services to in-memory infrastructure
 * (TigerBeetle, rate store, transaction repository) for fast, Docker-free tests.
 */
export async function createMoneyHarness(env: Record<string, string> = {}) {
  const config = validateEnv(env);
  const configService = { get: (key: keyof typeof config) => config[key] } as AppConfigService;

  const tb = new InMemoryTigerBeetle();
  const ledger = new LedgerService(tb);
  const provider = new StubRateProvider();
  const rateStore = new InMemoryRateStore();
  const fx = new FxRateService(provider, rateStore, new InMemoryLiveRateCache(), configService);
  const repository = new InMemoryTransactionRepository();
  const audits: AuditEntry[] = [];
  const audit = {
    publish: (entries: AuditEntry[]) => {
      audits.push(...entries);
      return Promise.resolve();
    },
  } as unknown as AuditPublisher;
  const finalized: string[] = [];
  const hook: TransactionFinalizedHook = {
    onFinalized: (tx) => {
      finalized.push(tx._id);
      return Promise.resolve();
    },
  };

  const operatorIds = new Map<string, string>();
  for (const currency of CURRENCY_CODES) {
    for (const type of Object.keys(OPERATOR_CODES) as OperatorAccountType[]) {
      const id = newId();
      operatorIds.set(`${type}:${currency}`, id);
      await ledger.createAccounts([
        {
          id,
          ledger: CURRENCIES[currency].ledger,
          code: OPERATOR_CODES[type],
          preventOverdraft: false,
        },
      ]);
    }
  }
  const operators = {
    getId: (type: OperatorAccountType, currency: CurrencyCode) =>
      Promise.resolve(operatorIds.get(`${type}:${currency}`)!),
  } as unknown as OperatorAccountsService;

  const wallets = new Map<
    string,
    { record: WalletRecord; accounts: Record<CurrencyCode, string> }
  >();
  const walletsService = {
    getActive: (id: string) => {
      const wallet = wallets.get(id);
      if (!wallet) {
        return Promise.reject(
          AppError.notFound(ErrorCode.WALLET_NOT_FOUND, `Wallet ${id} was not found`),
        );
      }
      return Promise.resolve(wallet.record);
    },
    accountIds: (id: string) => Promise.resolve(wallets.get(id)!.accounts),
    get: (id: string) =>
      wallets.has(id)
        ? Promise.resolve(wallets.get(id)!.record)
        : Promise.reject(
            AppError.notFound(ErrorCode.WALLET_NOT_FOUND, `Wallet ${id} was not found`),
          ),
  } as unknown as WalletsService;

  const listCache = new InMemoryTransactionListCache();
  const history = new TransactionHistoryService(
    repository,
    listCache,
    walletsService,
    configService,
  );
  const executor = new TransactionExecutor(repository, ledger, audit, [hook, history]);
  const service = new TransactionsService(
    repository,
    executor,
    walletsService,
    operators,
    fx,
    configService,
  );

  async function createWallet(): Promise<string> {
    const id = newId();
    const accounts = {} as Record<CurrencyCode, string>;
    for (const currency of CURRENCY_CODES) {
      accounts[currency] = newId();
      await ledger.createAccounts([
        {
          id: accounts[currency],
          ledger: CURRENCIES[currency].ledger,
          code: AccountCode.USER,
          preventOverdraft: true,
        },
      ]);
    }
    const now = new Date();
    wallets.set(id, {
      record: { _id: id, status: 'ACTIVE', created_at: now, updated_at: now },
      accounts,
    });
    return id;
  }

  function balance(walletId: string, currency: CurrencyCode): bigint {
    return tb.balanceOf(ulidToBigInt(wallets.get(walletId)!.accounts[currency]));
  }

  function operatorBalance(type: OperatorAccountType, currency: CurrencyCode): bigint {
    return tb.balanceOf(ulidToBigInt(operatorIds.get(`${type}:${currency}`)!));
  }

  /** Double-entry check: every ledger's balances sum to zero. */
  function ledgerTotals(): Map<number, bigint> {
    const totals = new Map<number, bigint>();
    for (const account of tb.accounts.values()) {
      totals.set(
        account.ledger,
        (totals.get(account.ledger) ?? 0n) + account.credits_posted - account.debits_posted,
      );
    }
    return totals;
  }

  let refs = 0;
  const reference = () => `ref-${++refs}-${newId()}`;

  return {
    tb,
    ledger,
    provider,
    rateStore,
    fx,
    repository,
    audits,
    finalized,
    executor,
    service,
    history,
    listCache,
    createWallet,
    balance,
    operatorBalance,
    ledgerTotals,
    reference,
  };
}

export type MoneyHarness = Awaited<ReturnType<typeof createMoneyHarness>>;
