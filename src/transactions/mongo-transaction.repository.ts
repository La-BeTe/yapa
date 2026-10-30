import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { isDuplicateKeyError } from '../database/mongo-errors';
import { Transaction } from './transaction.schema';
import {
  DuplicateReferenceError,
  Finalization,
  ListFilter,
  NewTransaction,
  TransactionRecord,
  TransactionRepository,
} from './transaction.types';

@Injectable()
export class MongoTransactionRepository implements TransactionRepository {
  constructor(@InjectModel(Transaction.name) private readonly model: Model<Transaction>) {}

  async insert(transaction: NewTransaction): Promise<TransactionRecord> {
    try {
      return (await this.model.create(transaction)).toObject<TransactionRecord>();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new DuplicateReferenceError(transaction.unique_reference);
      }
      throw error;
    }
  }

  findById(id: string): Promise<TransactionRecord | null> {
    return this.model.findById(id).lean<TransactionRecord>().exec();
  }

  findByReference(reference: string): Promise<TransactionRecord | null> {
    return this.model.findOne({ unique_reference: reference }).lean<TransactionRecord>().exec();
  }

  finalize(id: string, finalization: Finalization): Promise<TransactionRecord | null> {
    return this.model
      .findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: finalization }, { new: true })
      .lean<TransactionRecord>()
      .exec();
  }

  findStalePending(olderThan: Date, limit: number): Promise<TransactionRecord[]> {
    return this.model
      .find({ status: 'PENDING', updated_at: { $lt: olderThan } })
      .sort({ updated_at: 1 })
      .limit(limit)
      .lean<TransactionRecord[]>()
      .exec();
  }

  list({ walletId, type, currency, before, limit }: ListFilter): Promise<TransactionRecord[]> {
    const and: QueryFilter<Transaction>[] = [
      { $or: [{ 'source.wallet_id': walletId }, { 'destination.wallet_id': walletId }] },
    ];
    if (type) {
      and.push({ type });
    }
    if (currency) {
      and.push({ $or: [{ 'source.currency': currency }, { 'destination.currency': currency }] });
    }
    if (before) {
      and.push({ _id: { $lt: before } });
    }
    return this.model
      .find({ $and: and })
      .sort({ _id: -1 })
      .limit(limit)
      .lean<TransactionRecord[]>()
      .exec();
  }
}
