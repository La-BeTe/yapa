import { HttpStatus } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { AppError, ErrorCode } from '../common/http/app-error';

export interface WalletIdentity {
  email?: string;
  phone?: string;
}

/**
 * Canonicalises the identity used for wallet uniqueness: emails are trimmed and lower-cased,
 * phone numbers must be valid international numbers and are stored in E.164.
 */
export function normaliseIdentity(input: { email?: string; phone?: string }): WalletIdentity {
  const email = input.email?.trim().toLowerCase() || undefined;
  const rawPhone = input.phone?.trim() || undefined;

  if (!email && !rawPhone) {
    throw invalid('Provide an email address or a phone number');
  }

  let phone: string | undefined;
  if (rawPhone) {
    const parsed = parsePhoneNumberFromString(rawPhone);
    if (!parsed?.isValid()) {
      throw invalid('phone must be a valid international number, e.g. +2348031234567');
    }
    phone = parsed.number;
  }

  return { ...(email && { email }), ...(phone && { phone }) };
}

function invalid(message: string): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST);
}
