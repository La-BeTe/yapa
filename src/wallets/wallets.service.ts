import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LedgerAccount } from '../accounts/account.schema';
import { AuditPublisher } from '../audit/audit.publisher';
import { AppError, ErrorCode } from '../common/http/app-error';
import { newId } from '../common/ids/ulid';
import { isDuplicateKeyError, isDuplicateKeyOnly } from '../database/mongo-errors';
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from '../common/money/currency';
import { FxRateService } from '../fx/fx-rate.service';
import { AccountCode } from '../ledger/ledger.constants';
import { LedgerService } from '../ledger/ledger.service';
import { normaliseIdentity } from './identity';
import { Wallet } from './wallet.schema';
import type { CreateWalletDto } from './wallets.dto';

export type WalletRecord = Wallet;

export interface WalletBalance {
  currency: CurrencyCode;
  amount: bigint;
}

export interface WalletWithBalances {
  wallet: WalletRecord;
  balances: WalletBalance[];
  /** Sum of all balances in USDx minor units, or null when FX rates are unavailable. */
  totalUsd: bigint | null;
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @InjectModel(Wallet.name) private readonly wallets: Model<Wallet>,
    @InjectModel(LedgerAccount.name) private readonly accounts: Model<LedgerAccount>,
    private readonly ledger: LedgerService,
    private readonly fx: FxRateService,
    private readonly audit: AuditPublisher,
  ) {}

  /**
   * Creates a wallet and its five ledger accounts. Safe to retry: if an earlier attempt
   * stopped before the ledger accounts existed, retrying with the same identity finishes it.
   */
  async create(
    dto: CreateWalletDto,
    requestId?: string,
  ): Promise<{ wallet: WalletRecord; created: boolean }> {
    const identity = normaliseIdentity(dto);
    const existing = await this.findByIdentity(identity);
    if (existing) {
      if (existing.status === 'PROVISIONING' && sameIdentity(existing, identity)) {
        return { wallet: await this.activate(existing._id), created: true };
      }
      throw conflict();
    }

    let wallet: WalletRecord;
    try {
      wallet = (await this.wallets.create({ ...identity, status: 'PROVISIONING' })).toObject();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw conflict();
      }
      throw error;
    }

    await this.audit.publish([
      {
        wallet_id: wallet._id,
        event: 'WALLET_CREATED',
        request_id: requestId ?? null,
        metadata: { ...identity },
      },
    ]);
    return { wallet: await this.activate(wallet._id), created: true };
  }

  /** Ensures every per-currency account exists in Mongo and TigerBeetle, then activates. */
  async activate(walletId: string): Promise<WalletRecord> {
    const accounts = await this.ensureAccountDocs(walletId);
    await this.ledger.createAccounts(
      accounts.map((account) => ({
        id: account._id,
        ledger: account.ledger,
        code: AccountCode.USER,
        preventOverdraft: true,
      })),
    );
    const wallet = await this.wallets
      .findByIdAndUpdate(walletId, { $set: { status: 'ACTIVE' } }, { new: true })
      .lean<WalletRecord>();
    if (!wallet) {
      throw notFound(walletId);
    }
    await this.audit.publish([{ wallet_id: walletId, event: 'WALLET_ACTIVATED' }]);
    return wallet;
  }

  /** Wallets whose provisioning was interrupted (e.g. the ledger was unreachable). */
  findStaleProvisioning(olderThan: Date, limit: number): Promise<WalletRecord[]> {
    return this.wallets
      .find({ status: 'PROVISIONING', updated_at: { $lt: olderThan } })
      .sort({ updated_at: 1 })
      .limit(limit)
      .lean<WalletRecord[]>()
      .exec();
  }

  async get(walletId: string): Promise<WalletRecord> {
    const wallet = await this.wallets.findById(walletId).lean<WalletRecord>();
    if (!wallet) {
      throw notFound(walletId);
    }
    return wallet;
  }

  /** A wallet that can send or receive money. */
  async getActive(walletId: string): Promise<WalletRecord> {
    const wallet = await this.get(walletId);
    if (wallet.status !== 'ACTIVE') {
      throw new AppError(
        ErrorCode.WALLET_NOT_ACTIVE,
        `Wallet ${walletId} is still being provisioned`,
        HttpStatus.CONFLICT,
      );
    }
    return wallet;
  }

  /** Ledger account id per currency for a wallet. */
  async accountIds(walletId: string): Promise<Record<CurrencyCode, string>> {
    const docs = await this.accounts
      .find({ wallet_id: walletId, type: 'USER' })
      .lean<LedgerAccount[]>();
    const ids = Object.fromEntries(docs.map((doc) => [doc.currency, doc._id])) as Record<
      CurrencyCode,
      string
    >;
    for (const code of CURRENCY_CODES) {
      if (!ids[code]) {
        throw new AppError(
          ErrorCode.WALLET_NOT_ACTIVE,
          `Wallet ${walletId} has no ${code} account`,
          HttpStatus.CONFLICT,
        );
      }
    }
    return ids;
  }

  async getWithBalances(walletId: string): Promise<WalletWithBalances> {
    const wallet = await this.get(walletId);
    if (wallet.status !== 'ACTIVE') {
      return {
        wallet,
        balances: CURRENCY_CODES.map((currency) => ({ currency, amount: 0n })),
        totalUsd: 0n,
      };
    }
    const ids = await this.accountIds(walletId);
    const ledgerBalances = await this.ledger.getBalances(Object.values(ids));
    const balances = CURRENCY_CODES.map((currency) => ({
      currency,
      amount: ledgerBalances.get(ids[currency]) ?? 0n,
    }));

    let totalUsd: bigint | null = 0n;
    try {
      const values = await Promise.all(
        balances.map((b) => this.fx.valueInUsd(b.amount, b.currency)),
      );
      totalUsd = values.reduce((sum, value) => sum + value, 0n);
    } catch (error) {
      this.logger.warn(`Could not value wallet ${walletId} in USD: ${(error as Error).message}`);
      totalUsd = null;
    }
    return { wallet, balances, totalUsd };
  }

  private async ensureAccountDocs(walletId: string): Promise<LedgerAccount[]> {
    try {
      await this.accounts.bulkWrite(
        CURRENCY_CODES.map((currency) => ({
          updateOne: {
            filter: { wallet_id: walletId, type: 'USER', currency },
            // Upserts bypass schema defaults for _id, so the ULID is set explicitly.
            update: { $setOnInsert: { _id: newId(), ledger: CURRENCIES[currency].ledger } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    } catch (error) {
      // A concurrent activation inserted some of the same accounts; the unique index kept
      // exactly one per currency.
      if (!isDuplicateKeyOnly(error)) {
        throw error;
      }
    }
    return this.accounts.find({ wallet_id: walletId, type: 'USER' }).lean<LedgerAccount[]>();
  }

  private findByIdentity(identity: { email?: string; phone?: string }) {
    const or = [
      ...(identity.email ? [{ email: identity.email }] : []),
      ...(identity.phone ? [{ phone: identity.phone }] : []),
    ];
    return this.wallets.findOne({ $or: or }).lean<WalletRecord>();
  }
}

function sameIdentity(wallet: WalletRecord, identity: { email?: string; phone?: string }): boolean {
  return wallet.email === identity.email && wallet.phone === identity.phone;
}

function conflict(): AppError {
  return AppError.conflict(
    ErrorCode.WALLET_ALREADY_EXISTS,
    'A wallet with this email or phone number already exists',
  );
}

function notFound(walletId: string): AppError {
  return AppError.notFound(ErrorCode.WALLET_NOT_FOUND, `Wallet ${walletId} was not found`);
}
