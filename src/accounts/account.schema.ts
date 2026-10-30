import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { CURRENCY_CODES, type CurrencyCode } from '../common/money/currency';
import { newId } from '../common/ids/ulid';
import { schemaOptions } from '../database/schema-options';

export const ACCOUNT_TYPES = ['USER', 'TREASURY', 'FX_POOL', 'FEE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type OperatorAccountType = Exclude<AccountType, 'USER'>;

/**
 * Registry of ledger accounts. The `_id` is also the TigerBeetle account id, so balances
 * are looked up in TigerBeetle while ownership and metadata live here.
 */
@Schema(schemaOptions('accounts'))
export class LedgerAccount {
  @Prop({ type: String, default: () => newId() })
  _id!: string;

  /** Owning wallet; null for platform (operator) accounts. */
  @Prop({ type: String, default: null })
  wallet_id!: string | null;

  @Prop({ type: String, enum: ACCOUNT_TYPES, required: true })
  type!: AccountType;

  @Prop({ type: String, enum: CURRENCY_CODES, required: true })
  currency!: CurrencyCode;

  @Prop({ type: Number, required: true })
  ledger!: number;

  created_at!: Date;
  updated_at!: Date;
}

export type LedgerAccountDocument = HydratedDocument<LedgerAccount>;
export const LedgerAccountSchema = SchemaFactory.createForClass(LedgerAccount);

LedgerAccountSchema.index(
  { wallet_id: 1, currency: 1 },
  { unique: true, partialFilterExpression: { type: 'USER' } },
);
LedgerAccountSchema.index(
  { type: 1, currency: 1 },
  { unique: true, partialFilterExpression: { type: { $in: ['TREASURY', 'FX_POOL', 'FEE'] } } },
);
