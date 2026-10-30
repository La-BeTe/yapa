import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { failure, success } from './envelope';

/** Documents a success envelope with an example payload. */
export const ApiSuccess = (status: number, message: string, data: unknown) =>
  ApiResponse({ status, description: message, schema: { example: success(message, data) } });

/** Documents an error envelope for each listed code. */
export const ApiErrors = (...errors: Array<[status: number, code: string, message: string]>) =>
  applyDecorators(
    ...errors.map(([status, code, message]) =>
      ApiResponse({ status, description: code, schema: { example: failure(code, message) } }),
    ),
  );

const WALLET_ID = '01JBWALLETALICE0000000000A';
const OTHER_WALLET_ID = '01JBWALLETBOB000000000000B';
const TX_ID = '01JBTXN0000000000000000001';
const AT = '2026-10-30T12:00:00.000Z';

export const examples = {
  wallet: {
    id: WALLET_ID,
    email: 'ada@example.com',
    phone: '+2348031234567',
    status: 'ACTIVE',
    created_at: AT,
    updated_at: AT,
  },
  walletWithBalances: {
    id: WALLET_ID,
    email: 'ada@example.com',
    phone: '+2348031234567',
    status: 'ACTIVE',
    created_at: AT,
    updated_at: AT,
    balances: [
      { currency: 'cNGN', amount: '750000', scale: 2 },
      { currency: 'cGHS', amount: '0', scale: 2 },
      { currency: 'cXAF', amount: '0', scale: 0 },
      { currency: 'USDx', amount: '98', scale: 2 },
      { currency: 'EURx', amount: '0', scale: 2 },
    ],
    total_usd: { currency: 'USDx', amount: '598', scale: 2 },
  },
  transaction: {
    id: TX_ID,
    type: 'TRANSFER',
    status: 'COMPLETED',
    unique_reference: 'order-7f3a9c',
    source: { wallet_id: WALLET_ID, amount: '400', currency: 'USDx', scale: 2 },
    destination: { wallet_id: OTHER_WALLET_ID, amount: '4975', currency: 'cGHS', scale: 2 },
    fx: {
      mid_rate: '12.5',
      effective_rate: '12.4375',
      spread_bps: 50,
      fee_amount: '25',
      rate_source: 'live',
      rate_refreshed_at: AT,
    },
    failure: null,
    created_at: AT,
    completed_at: AT,
  },
  fxQuote: {
    base_currency: 'USDx',
    quote_currency: 'cNGN',
    mid_rate: '1500',
    spread_bps: 50,
    effective_rate: '1492.5',
    source: 'live',
    refreshed_at: AT,
  },
};
