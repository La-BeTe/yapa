import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { newId } from '../common/ids/ulid';
import { CURRENCY_CODES } from '../common/money/currency';
import { schemaOptions } from '../database/schema-options';
import {
  LedgerLeg,
  StoredResponse,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  type TransactionFx,
  type TransactionSide,
  type TransactionStatus,
  type TransactionType,
} from './transaction.types';

const SideSchema = new MongooseSchema<TransactionSide>(
  {
    wallet_id: { type: String, default: null },
    amount: { type: String, required: true },
    currency: { type: String, enum: CURRENCY_CODES, required: true },
  },
  { _id: false },
);

const FxSchema = new MongooseSchema<TransactionFx>(
  {
    mid_rate: { type: String, required: true },
    effective_rate: { type: String, required: true },
    spread_bps: { type: Number, required: true },
    fee_amount: { type: String, required: true },
    rate_source: { type: String, enum: ['live', 'static', 'fallback'], required: true },
    rate_refreshed_at: { type: String, required: true },
  },
  { _id: false },
);

const LegSchema = new MongooseSchema<LedgerLeg>(
  {
    id: { type: String, required: true },
    debit_account_id: { type: String, required: true },
    credit_account_id: { type: String, required: true },
    amount: { type: String, required: true },
    ledger: { type: Number, required: true },
    code: { type: Number, required: true },
  },
  { _id: false },
);

@Schema(schemaOptions('transactions'))
export class Transaction {
  @Prop({ type: String, default: () => newId() })
  _id!: string;

  @Prop({ type: String, enum: TRANSACTION_TYPES, required: true })
  type!: TransactionType;

  @Prop({ type: String, enum: TRANSACTION_STATUSES, required: true })
  status!: TransactionStatus;

  @Prop({ type: String, required: true, unique: true })
  unique_reference!: string;

  @Prop({ type: String, required: true })
  request_hash!: string;

  @Prop({ type: SideSchema, required: true })
  source!: TransactionSide;

  @Prop({ type: SideSchema, required: true })
  destination!: TransactionSide;

  @Prop({ type: FxSchema, default: null })
  fx!: TransactionFx | null;

  @Prop({ type: [LegSchema], default: [] })
  ledger_transfers!: LedgerLeg[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  failure!: { code: string; message: string } | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  response!: StoredResponse | null;

  @Prop({ type: String, default: null })
  request_id!: string | null;

  @Prop({ type: Date, default: null })
  completed_at!: Date | null;

  created_at!: Date;
  updated_at!: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
// History reads: a wallet's transactions on either side, newest first (ULIDs sort by time).
TransactionSchema.index({ 'source.wallet_id': 1, _id: -1 });
TransactionSchema.index({ 'destination.wallet_id': 1, _id: -1 });
// Reconciler scan for transactions stuck between Mongo and TigerBeetle.
TransactionSchema.index(
  { status: 1, updated_at: 1 },
  { partialFilterExpression: { status: 'PENDING' } },
);
