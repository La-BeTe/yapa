import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CURRENCY_CODES, type CurrencyCode } from '../common/money/currency';
import { newId } from '../common/ids/ulid';
import { schemaOptions } from '../database/schema-options';

/**
 * Per-pair FX configuration and static rate. The static `rate` is the fallback when live
 * rates are unavailable, or the rate actually used when `prefer_static` is set.
 */
@Schema(schemaOptions('fx_rates'))
export class FxRate {
  @Prop({ type: String, default: () => newId() })
  _id!: string;

  @Prop({ type: String, enum: CURRENCY_CODES, required: true })
  base_currency!: CurrencyCode;

  @Prop({ type: String, enum: CURRENCY_CODES, required: true })
  quote_currency!: CurrencyCode;

  /** Units of quote currency per one unit of base currency, as a decimal string. */
  @Prop({ type: String, required: true })
  rate!: string;

  @Prop({ type: Number, required: true, min: 0, max: 9999 })
  spread_bps!: number;

  @Prop({ type: Boolean, default: false })
  prefer_static!: boolean;

  /** Who last set `rate`: the live provider sync or an admin. */
  @Prop({ type: String, enum: ['provider', 'admin'], required: true })
  source!: 'provider' | 'admin';

  created_at!: Date;
  updated_at!: Date;
}

export const FxRateSchema = SchemaFactory.createForClass(FxRate);
FxRateSchema.index({ base_currency: 1, quote_currency: 1 }, { unique: true });
