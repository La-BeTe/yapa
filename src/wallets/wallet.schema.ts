import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { newId } from '../common/ids/ulid';
import { schemaOptions } from '../database/schema-options';

export const WALLET_STATUSES = ['PROVISIONING', 'ACTIVE'] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

@Schema(schemaOptions('wallets'))
export class Wallet {
  @Prop({ type: String, default: () => newId() })
  _id!: string;

  /** Lower-cased email; unique when present. */
  @Prop({ type: String })
  email?: string;

  /** E.164 phone number; unique when present. */
  @Prop({ type: String })
  phone?: string;

  /** PROVISIONING until its ledger accounts exist in TigerBeetle. */
  @Prop({ type: String, enum: WALLET_STATUSES, required: true, default: 'PROVISIONING' })
  status!: WalletStatus;

  created_at!: Date;
  updated_at!: Date;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
WalletSchema.index({ email: 1 }, { unique: true, sparse: true });
WalletSchema.index({ phone: 1 }, { unique: true, sparse: true });
WalletSchema.index({ status: 1, updated_at: 1 });
