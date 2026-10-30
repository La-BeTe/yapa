import { CURRENCIES } from '../common/money/currency';
import type { WalletRecord, WalletWithBalances } from './wallets.service';

export function presentWallet(wallet: WalletRecord) {
  return {
    id: wallet._id,
    email: wallet.email ?? null,
    phone: wallet.phone ?? null,
    status: wallet.status,
    created_at: new Date(wallet.created_at).toISOString(),
    updated_at: new Date(wallet.updated_at).toISOString(),
  };
}

export function presentWalletWithBalances({ wallet, balances, totalUsd }: WalletWithBalances) {
  return {
    ...presentWallet(wallet),
    balances: balances.map(({ currency, amount }) => ({
      currency,
      amount: amount.toString(),
      scale: CURRENCIES[currency].scale,
    })),
    total_usd:
      totalUsd === null
        ? null
        : { currency: 'USDx', amount: totalUsd.toString(), scale: CURRENCIES.USDx.scale },
  };
}
