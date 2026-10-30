import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { newId } from '../common/ids/ulid';
import { schemaOptions } from '../database/schema-options';

/** One HTTP exchange, keyed by the X-Request-Id returned to the client, for debugging. */
@Schema(schemaOptions('request_logs', false))
export class RequestLog {
  @Prop({ type: String, default: () => newId() })
  _id!: string;

  @Prop({ type: String, required: true, unique: true })
  request_id!: string;

  @Prop({ type: String, required: true })
  method!: string;

  @Prop({ type: String, required: true })
  path!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  query!: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  headers!: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  body!: unknown;

  @Prop({ type: String, default: null })
  ip!: string | null;

  @Prop({ type: Number, required: true })
  response_status!: number;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  response_body!: unknown;

  @Prop({ type: Number, required: true })
  duration_ms!: number;

  @Prop({ type: Date, required: true })
  occurred_at!: Date;
}

export const RequestLogSchema = SchemaFactory.createForClass(RequestLog);

export type RequestLogEntry = Omit<RequestLog, '_id' | 'occurred_at'> & { occurred_at: string };
