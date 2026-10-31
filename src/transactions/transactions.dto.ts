import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CURRENCY_CODES, type CurrencyCode } from '../common/money/currency';
import { TRANSACTION_TYPES, type TransactionType } from './transaction.types';

/**
 * One endpoint for every money movement. Required fields by type:
 * - DEPOSIT:  destination_wallet_id, currency
 * - SWAP:     source_wallet_id, source_currency, destination_currency
 * - TRANSFER: source_wallet_id, destination_wallet_id, source_currency,
 *             destination_currency (optional, defaults to source_currency)
 */
export class CreateTransactionDto {
  @ApiProperty({ enum: TRANSACTION_TYPES })
  @IsIn(TRANSACTION_TYPES)
  type!: TransactionType;

  @ApiProperty({
    example: 'order-7f3a9c',
    description:
      'Client-chosen idempotency key; globally unique. Retrying with the same value and body replays the original result.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: 'unique_reference may contain letters, digits, ".", "_", ":" and "-"',
  })
  unique_reference!: string;

  @ApiProperty({
    example: '500000',
    description: 'Source amount as an integer string of minor units',
  })
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amount must be a positive integer string in minor units' })
  amount!: string;

  @ApiPropertyOptional({ description: 'DEPOSIT only: currency to deposit', enum: CURRENCY_CODES })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ description: 'SWAP and TRANSFER' })
  @IsOptional()
  @IsString()
  source_wallet_id?: string;

  @ApiPropertyOptional({ description: 'DEPOSIT and TRANSFER' })
  @IsOptional()
  @IsString()
  destination_wallet_id?: string;

  @ApiPropertyOptional({ enum: CURRENCY_CODES, description: 'SWAP and TRANSFER' })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  source_currency?: CurrencyCode;

  @ApiPropertyOptional({ enum: CURRENCY_CODES, description: 'SWAP and TRANSFER' })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  destination_currency?: CurrencyCode;
}

export class ListTransactionsQuery {
  @ApiProperty({ description: 'Wallet whose transactions to list (sent and received)' })
  @IsString()
  @MinLength(1)
  wallet_id!: string;

  @ApiPropertyOptional({ enum: TRANSACTION_TYPES })
  @IsOptional()
  @IsIn(TRANSACTION_TYPES)
  type?: TransactionType;

  @ApiPropertyOptional({
    enum: CURRENCY_CODES,
    description: 'Matches the source or destination currency',
  })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'next_cursor from the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
