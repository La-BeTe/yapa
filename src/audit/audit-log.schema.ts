import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { newId } from '../common/ids/ulid';
import { schemaOptions } from '../database/schema-options';

export const AUDIT_EVENTS = [
  'WALLET_CREATED',
  'WALLET_ACTIVATED',
  'DEPOSIT_COMPLETED',
  'SWAP_COMPLETED',
  'TRANSFER_SENT',
  'TRANSFER_RECEIVED',
  'TRANSACTION_FAILED',
  'TRANSACTION_RECONCILED',
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

/** Append-only trail of everything that happened to a wallet. */
@Schema(schemaOptions('audit_logs', false))
export class AuditLog {
  @Prop({ type: String, default: () => newId() })
  _id!: string;

  @Prop({ type: String, required: true })
  wallet_id!: string;

  @Prop({ type: String, enum: AUDIT_EVENTS, required: true })
  event!: AuditEvent;

  @Prop({ type: String, default: null })
  transaction_id!: string | null;

  @Prop({ type: String, default: null })
  request_id!: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ type: Date, required: true })
  occurred_at!: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ wallet_id: 1, _id: -1 });
// One record per (wallet, event, transaction): retried jobs cannot duplicate entries.
AuditLogSchema.index({ wallet_id: 1, event: 1, transaction_id: 1 }, { unique: true });

export interface AuditEntry {
  wallet_id: string;
  event: AuditEvent;
  transaction_id?: string | null;
  request_id?: string | null;
  metadata?: Record<string, unknown>;
  occurred_at?: string;
}
