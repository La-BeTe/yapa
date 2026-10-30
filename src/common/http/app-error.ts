import { HttpStatus } from '@nestjs/common';

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  WALLET_ALREADY_EXISTS: 'WALLET_ALREADY_EXISTS',
  WALLET_NOT_ACTIVE: 'WALLET_NOT_ACTIVE',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  TRANSACTION_IN_PROGRESS: 'TRANSACTION_IN_PROGRESS',
  TRANSACTION_PENDING: 'TRANSACTION_PENDING',
  TRANSACTION_REJECTED: 'TRANSACTION_REJECTED',
  UNIQUE_REFERENCE_REUSED: 'UNIQUE_REFERENCE_REUSED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  AMOUNT_TOO_SMALL: 'AMOUNT_TOO_SMALL',
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  SAME_CURRENCY_SWAP: 'SAME_CURRENCY_SWAP',
  SAME_WALLET_TRANSFER: 'SAME_WALLET_TRANSFER',
  FX_RATE_UNAVAILABLE: 'FX_RATE_UNAVAILABLE',
  LEDGER_ERROR: 'LEDGER_ERROR',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Domain error carrying a stable machine-readable code, mapped to the error envelope. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly httpStatus: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(code: ErrorCode, message: string): AppError {
    return new AppError(code, message, HttpStatus.NOT_FOUND);
  }

  static conflict(code: ErrorCode, message: string): AppError {
    return new AppError(code, message, HttpStatus.CONFLICT);
  }
}
