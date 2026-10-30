import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppError, ErrorCode } from '../common/http/app-error';
import type { CurrencyCode } from '../common/money/currency';
import { parseMinorUnits } from '../common/money/money';
import type { TransactionType } from './transaction.types';
import type { CreateTransactionDto } from './transactions.dto';

/** A validated, type-independent description of a money movement. */
export interface TransactionCommand {
  type: TransactionType;
  reference: string;
  amount: bigint;
  sourceWalletId: string | null;
  destinationWalletId: string;
  sourceCurrency: CurrencyCode;
  destinationCurrency: CurrencyCode;
}

type Field = keyof CreateTransactionDto;

const ALLOWED_FIELDS: Record<TransactionType, Field[]> = {
  DEPOSIT: ['destination_wallet_id', 'currency'],
  SWAP: ['source_wallet_id', 'source_currency', 'destination_currency'],
  TRANSFER: [
    'source_wallet_id',
    'destination_wallet_id',
    'source_currency',
    'destination_currency',
  ],
};
const TYPE_SPECIFIC: Field[] = [
  'currency',
  'source_wallet_id',
  'destination_wallet_id',
  'source_currency',
  'destination_currency',
];

export function toCommand(dto: CreateTransactionDto): TransactionCommand {
  const allowed = ALLOWED_FIELDS[dto.type];
  const unexpected = TYPE_SPECIFIC.filter(
    (field) => dto[field] !== undefined && !allowed.includes(field),
  );
  if (unexpected.length > 0) {
    throw badRequest(`${unexpected.join(', ')} not allowed for ${dto.type}`);
  }
  const amount = parseMinorUnits(dto.amount);

  switch (dto.type) {
    case 'DEPOSIT': {
      const walletId = required(dto, 'destination_wallet_id');
      const currency = required(dto, 'currency');
      return {
        type: 'DEPOSIT',
        reference: dto.unique_reference,
        amount,
        sourceWalletId: null,
        destinationWalletId: walletId,
        sourceCurrency: currency,
        destinationCurrency: currency,
      };
    }
    case 'SWAP': {
      const walletId = required(dto, 'source_wallet_id');
      const from = required(dto, 'source_currency');
      const to = required(dto, 'destination_currency');
      if (from === to) {
        throw new AppError(ErrorCode.SAME_CURRENCY_SWAP, 'A swap needs two different currencies');
      }
      return {
        type: 'SWAP',
        reference: dto.unique_reference,
        amount,
        sourceWalletId: walletId,
        destinationWalletId: walletId,
        sourceCurrency: from,
        destinationCurrency: to,
      };
    }
    case 'TRANSFER': {
      const from = required(dto, 'source_wallet_id');
      const to = required(dto, 'destination_wallet_id');
      if (from === to) {
        throw new AppError(
          ErrorCode.SAME_WALLET_TRANSFER,
          'Use a SWAP to convert currencies within the same wallet',
        );
      }
      const sourceCurrency = required(dto, 'source_currency');
      return {
        type: 'TRANSFER',
        reference: dto.unique_reference,
        amount,
        sourceWalletId: from,
        destinationWalletId: to,
        sourceCurrency,
        destinationCurrency: dto.destination_currency ?? sourceCurrency,
      };
    }
  }
}

/**
 * Fingerprint of what the client asked for. A reused unique_reference with a different
 * fingerprint is a client error, not a replay.
 */
export function commandHash(command: TransactionCommand): string {
  const canonical = JSON.stringify([
    command.type,
    command.reference,
    command.amount.toString(),
    command.sourceWalletId,
    command.destinationWalletId,
    command.sourceCurrency,
    command.destinationCurrency,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

function required<K extends Field>(
  dto: CreateTransactionDto,
  field: K,
): NonNullable<CreateTransactionDto[K]> {
  const value = dto[field];
  if (value === undefined || value === null || value === '') {
    throw badRequest(`${field} is required for ${dto.type}`);
  }
  return value;
}

function badRequest(message: string): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST);
}
