import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from '../common/money/currency';
import { AccountCode } from '../ledger/ledger.constants';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerAccount, OperatorAccountType } from './account.schema';

const OPERATOR_TYPES: Record<OperatorAccountType, AccountCode> = {
  TREASURY: AccountCode.TREASURY,
  FX_POOL: AccountCode.FX_POOL,
  FEE: AccountCode.FEE,
};

const DUPLICATE_KEY = 11000;

/**
 * Platform-owned accounts, one of each type per currency ledger:
 * - TREASURY funds simulated deposits,
 * - FX_POOL is the counterparty for every currency conversion,
 * - FEE collects the FX spread.
 * They are created idempotently on boot and cached for the process lifetime.
 */
@Injectable()
export class OperatorAccountsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OperatorAccountsService.name);
  private readonly cache = new Map<string, string>();

  constructor(
    @InjectModel(LedgerAccount.name) private readonly accounts: Model<LedgerAccount>,
    private readonly ledger: LedgerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureAll();
  }

  async ensureAll(): Promise<void> {
    const specs = CURRENCY_CODES.flatMap((currency) =>
      (Object.keys(OPERATOR_TYPES) as OperatorAccountType[]).map((type) => ({ type, currency })),
    );
    const docs = await Promise.all(
      specs.map(({ type, currency }) => this.findOrCreate(type, currency)),
    );
    await this.ledger.createAccounts(
      docs.map((doc) => ({
        id: doc._id,
        ledger: doc.ledger,
        code: OPERATOR_TYPES[doc.type as OperatorAccountType],
        preventOverdraft: false,
      })),
    );
    docs.forEach((doc) =>
      this.cache.set(key(doc.type as OperatorAccountType, doc.currency), doc._id),
    );
    this.logger.log(`Operator accounts ready (${docs.length})`);
  }

  async getId(type: OperatorAccountType, currency: CurrencyCode): Promise<string> {
    const cached = this.cache.get(key(type, currency));
    if (cached) {
      return cached;
    }
    await this.ensureAll();
    return this.cache.get(key(type, currency))!;
  }

  private async findOrCreate(type: OperatorAccountType, currency: CurrencyCode) {
    const existing = await this.accounts.findOne({ type, currency }).lean();
    if (existing) {
      return existing;
    }
    try {
      return (
        await this.accounts.create({
          type,
          currency,
          wallet_id: null,
          ledger: CURRENCIES[currency].ledger,
        })
      ).toObject();
    } catch (error) {
      // Another instance created it concurrently.
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        return (await this.accounts.findOne({ type, currency }).lean())!;
      }
      throw error;
    }
  }
}

function key(type: OperatorAccountType, currency: CurrencyCode): string {
  return `${type}:${currency}`;
}
