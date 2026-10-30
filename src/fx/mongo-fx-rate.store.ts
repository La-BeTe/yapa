import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model } from 'mongoose';
import type { CurrencyCode } from '../common/money/currency';
import { FxRate } from './fx-rate.schema';
import type { FxRateStore, RateUpdate, StoredRate } from './fx.types';

@Injectable()
export class MongoFxRateStore implements FxRateStore {
  constructor(@InjectModel(FxRate.name) private readonly model: Model<FxRate>) {}

  find(base: CurrencyCode, quote: CurrencyCode): Promise<StoredRate | null> {
    return this.model
      .findOne({ base_currency: base, quote_currency: quote })
      .lean<StoredRate>()
      .exec();
  }

  findAll(): Promise<StoredRate[]> {
    return this.model
      .find()
      .sort({ base_currency: 1, quote_currency: 1 })
      .lean<StoredRate[]>()
      .exec();
  }

  async syncFromLive(
    rates: Array<{ base: CurrencyCode; quote: CurrencyCode; rate: string }>,
    defaultSpreadBps: number,
  ): Promise<void> {
    const ops: AnyBulkWriteOperation<FxRate>[] = rates.flatMap(({ base, quote, rate }) => [
      {
        updateOne: {
          filter: { base_currency: base, quote_currency: quote },
          update: {
            $setOnInsert: {
              rate,
              spread_bps: defaultSpreadBps,
              prefer_static: false,
              source: 'provider',
            },
          },
          upsert: true,
        },
      },
      {
        updateOne: {
          filter: { base_currency: base, quote_currency: quote, prefer_static: false },
          update: { $set: { rate, source: 'provider' } },
        },
      },
    ]);
    await this.model.bulkWrite(ops, { ordered: true });
  }

  update(base: CurrencyCode, quote: CurrencyCode, update: RateUpdate): Promise<StoredRate | null> {
    const set: Record<string, unknown> = { ...update };
    if (update.rate !== undefined) {
      set.source = 'admin';
    }
    return this.model
      .findOneAndUpdate(
        { base_currency: base, quote_currency: quote },
        { $set: set },
        { new: true },
      )
      .lean<StoredRate>()
      .exec();
  }
}
