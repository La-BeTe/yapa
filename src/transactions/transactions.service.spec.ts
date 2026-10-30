import { createMoneyHarness, type MoneyHarness } from '../../test/support/money-harness';
import { AppError } from '../common/http/app-error';
import type { CreateTransactionDto } from './transactions.dto';

type Body = {
  status: string;
  message: string;
  data: Record<string, unknown> & { code?: string };
};

describe('TransactionsService', () => {
  let h: MoneyHarness;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    h = await createMoneyHarness({ RECONCILER_STALE_AFTER_MS: '1000' });
    alice = await h.createWallet();
    bob = await h.createWallet();
  });

  const deposit = (walletId: string, currency: string, amount: string, reference = h.reference()) =>
    h.service.create({
      type: 'DEPOSIT',
      unique_reference: reference,
      destination_wallet_id: walletId,
      currency,
      amount,
    } as CreateTransactionDto);

  const errorCode = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
    }
    return 'NO_ERROR';
  };

  const expectLedgersBalanced = () => {
    for (const [ledger, total] of h.ledgerTotals()) {
      expect([ledger, total]).toEqual([ledger, 0n]);
    }
  };

  describe('deposits', () => {
    it('credits the wallet and returns the completed transaction', async () => {
      const res = await deposit(alice, 'cNGN', '500000');
      const body = res.body as Body;

      expect(res.http_status).toBe(201);
      expect(body).toMatchObject({
        status: 'success',
        message: 'Transaction completed',
        data: {
          type: 'DEPOSIT',
          status: 'COMPLETED',
          source: { wallet_id: null, amount: '500000', currency: 'cNGN', scale: 2 },
          destination: { wallet_id: alice, amount: '500000', currency: 'cNGN', scale: 2 },
          fx: null,
          failure: null,
        },
      });
      expect(h.balance(alice, 'cNGN')).toBe(500000n);
      expect(h.operatorBalance('TREASURY', 'cNGN')).toBe(-500000n);
      expectLedgersBalanced();
      expect(h.audits).toContainEqual(
        expect.objectContaining({ wallet_id: alice, event: 'DEPOSIT_COMPLETED' }),
      );
    });

    it('rejects unknown wallets without recording anything', async () => {
      expect(await errorCode(deposit('01JZZZZZZZZZZZZZZZZZZZZZZZ', 'cNGN', '1'))).toBe(
        'WALLET_NOT_FOUND',
      );
      expect(h.repository.rows.size).toBe(0);
    });
  });

  describe('swaps', () => {
    it('converts within a wallet at the live rate minus the pair spread', async () => {
      await deposit(alice, 'cNGN', '500000');
      const res = await h.service.create({
        type: 'SWAP',
        unique_reference: h.reference(),
        source_wallet_id: alice,
        source_currency: 'cNGN',
        destination_currency: 'USDx',
        amount: '500000',
      });

      // 5,000.00 NGN at 1/1500 = 3.333 USD -> 333 minor units; 50 bps fee = 1; net 332.
      expect(res.http_status).toBe(201);
      expect((res.body as Body).data).toMatchObject({
        type: 'SWAP',
        source: { wallet_id: alice, amount: '500000', currency: 'cNGN' },
        destination: { wallet_id: alice, amount: '332', currency: 'USDx' },
        fx: {
          mid_rate: '0.00066666666666666666667',
          spread_bps: 50,
          fee_amount: '1',
          rate_source: 'live',
        },
      });
      expect(h.balance(alice, 'cNGN')).toBe(0n);
      expect(h.balance(alice, 'USDx')).toBe(332n);
      expect(h.operatorBalance('FX_POOL', 'cNGN')).toBe(500000n);
      expect(h.operatorBalance('FX_POOL', 'USDx')).toBe(-333n);
      expect(h.operatorBalance('FEE', 'USDx')).toBe(1n);
      expectLedgersBalanced();
    });

    it('rejects swaps that would overdraw and leaves balances untouched', async () => {
      await deposit(alice, 'cNGN', '1000000');
      const res = await h.service.create({
        type: 'SWAP',
        unique_reference: h.reference(),
        source_wallet_id: alice,
        source_currency: 'cNGN',
        destination_currency: 'EURx',
        amount: '1000001',
      });

      expect(res.http_status).toBe(422);
      expect(res.body).toMatchObject({ status: 'error', data: { code: 'INSUFFICIENT_FUNDS' } });
      expect(h.balance(alice, 'cNGN')).toBe(1000000n);
      expect(h.balance(alice, 'EURx')).toBe(0n);
      expect(h.operatorBalance('FX_POOL', 'EURx')).toBe(0n);
      expect([...h.repository.rows.values()].at(-1)).toMatchObject({
        status: 'FAILED',
        failure: { code: 'INSUFFICIENT_FUNDS' },
      });
    });

    it('rejects amounts too small to convert', async () => {
      await deposit(alice, 'cNGN', '1000');
      expect(
        await errorCode(
          h.service.create({
            type: 'SWAP',
            unique_reference: h.reference(),
            source_wallet_id: alice,
            source_currency: 'cNGN',
            destination_currency: 'USDx',
            amount: '1',
          }),
        ),
      ).toBe('AMOUNT_TOO_SMALL');
    });

    it('rejects same-currency swaps', async () => {
      expect(
        await errorCode(
          h.service.create({
            type: 'SWAP',
            unique_reference: h.reference(),
            source_wallet_id: alice,
            source_currency: 'USDx',
            destination_currency: 'USDx',
            amount: '1',
          }),
        ),
      ).toBe('SAME_CURRENCY_SWAP');
    });

    it('records the static rate for pairs that prefer it', async () => {
      await h.fx.refresh();
      await h.fx.updateStored('USDx', 'EURx', { rate: '0.5', prefer_static: true, spread_bps: 0 });
      await deposit(alice, 'USDx', '1000');
      const res = await h.service.create({
        type: 'SWAP',
        unique_reference: h.reference(),
        source_wallet_id: alice,
        source_currency: 'USDx',
        destination_currency: 'EURx',
        amount: '1000',
      });
      expect((res.body as Body).data).toMatchObject({
        destination: { amount: '500', currency: 'EURx' },
        fx: { mid_rate: '0.5', rate_source: 'static', fee_amount: '0' },
      });
    });
  });

  describe('transfers', () => {
    it('moves funds between wallets in the same currency', async () => {
      await deposit(alice, 'USDx', '10000');
      const res = await h.service.create({
        type: 'TRANSFER',
        unique_reference: h.reference(),
        source_wallet_id: alice,
        destination_wallet_id: bob,
        source_currency: 'USDx',
        amount: '2500',
      });

      expect((res.body as Body).data).toMatchObject({
        type: 'TRANSFER',
        source: { wallet_id: alice, amount: '2500', currency: 'USDx' },
        destination: { wallet_id: bob, amount: '2500', currency: 'USDx' },
        fx: null,
      });
      expect(h.balance(alice, 'USDx')).toBe(7500n);
      expect(h.balance(bob, 'USDx')).toBe(2500n);
      expect(h.audits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ wallet_id: alice, event: 'TRANSFER_SENT' }),
          expect.objectContaining({ wallet_id: bob, event: 'TRANSFER_RECEIVED' }),
        ]),
      );
    });

    it('converts automatically when currencies differ, recording rate and amounts', async () => {
      await deposit(alice, 'USDx', '1000');
      const res = await h.service.create({
        type: 'TRANSFER',
        unique_reference: h.reference(),
        source_wallet_id: alice,
        destination_wallet_id: bob,
        source_currency: 'USDx',
        destination_currency: 'cGHS',
        amount: '1000',
      });

      // 10.00 USD at 12.5 = 125.00 GHS -> 12500; 50 bps fee = 62; net 12438.
      expect((res.body as Body).data).toMatchObject({
        source: { wallet_id: alice, amount: '1000', currency: 'USDx' },
        destination: { wallet_id: bob, amount: '12438', currency: 'cGHS' },
        fx: { mid_rate: '12.5', fee_amount: '62', spread_bps: 50 },
        created_at: expect.any(String),
      });
      expect(h.balance(bob, 'cGHS')).toBe(12438n);
      expect(h.operatorBalance('FEE', 'cGHS')).toBe(62n);
      expectLedgersBalanced();
    });

    it('handles zero-decimal currencies', async () => {
      await deposit(alice, 'cXAF', '1000');
      const res = await h.service.create({
        type: 'TRANSFER',
        unique_reference: h.reference(),
        source_wallet_id: alice,
        destination_wallet_id: bob,
        source_currency: 'cXAF',
        destination_currency: 'cNGN',
        amount: '1000',
      });
      // 1,000 XAF at 2.5 = 2,500.00 NGN -> 250000; fee 1250; net 248750.
      expect((res.body as Body).data).toMatchObject({
        destination: { amount: '248750', currency: 'cNGN', scale: 2 },
        source: { scale: 0 },
      });
    });

    it('rejects transfers to the same wallet', async () => {
      expect(
        await errorCode(
          h.service.create({
            type: 'TRANSFER',
            unique_reference: h.reference(),
            source_wallet_id: alice,
            destination_wallet_id: alice,
            source_currency: 'USDx',
            amount: '1',
          }),
        ),
      ).toBe('SAME_WALLET_TRANSFER');
    });
  });

  describe('validation', () => {
    it.each([
      [{ type: 'DEPOSIT', currency: 'cNGN' }, /destination_wallet_id is required/],
      [
        { type: 'DEPOSIT', destination_wallet_id: 'W', currency: 'cNGN', source_wallet_id: 'X' },
        /source_wallet_id not allowed/,
      ],
      [
        { type: 'SWAP', source_wallet_id: 'W', source_currency: 'cNGN' },
        /destination_currency is required/,
      ],
      [
        { type: 'TRANSFER', source_wallet_id: 'W', destination_wallet_id: 'V' },
        /source_currency is required/,
      ],
      [
        {
          type: 'TRANSFER',
          source_wallet_id: 'W',
          destination_wallet_id: 'V',
          source_currency: 'cNGN',
          currency: 'cNGN',
        },
        /currency not allowed/,
      ],
    ])('rejects %p', async (fields, message) => {
      await expect(
        h.service.create({
          unique_reference: h.reference(),
          amount: '1',
          ...fields,
        } as CreateTransactionDto),
      ).rejects.toThrow(message);
    });
  });

  describe('idempotency', () => {
    it('replays the original response for a repeated unique_reference without moving money twice', async () => {
      const reference = h.reference();
      const first = await deposit(alice, 'cGHS', '700', reference);
      const second = await deposit(alice, 'cGHS', '700', reference);

      expect(second).toEqual(first);
      expect(h.balance(alice, 'cGHS')).toBe(700n);
      expect(h.repository.rows.size).toBe(1);
    });

    it('replays failures too', async () => {
      const reference = h.reference();
      const swap = () =>
        h.service.create({
          type: 'SWAP',
          unique_reference: reference,
          source_wallet_id: alice,
          source_currency: 'cNGN',
          destination_currency: 'USDx',
          amount: '100000',
        });
      const first = await swap();
      await deposit(alice, 'cNGN', '100000');
      const second = await swap();

      expect(first.http_status).toBe(422);
      expect(second).toEqual(first);
      expect(h.balance(alice, 'cNGN')).toBe(100000n);
    });

    it('rejects a reused unique_reference with a different body', async () => {
      const reference = h.reference();
      await deposit(alice, 'cGHS', '700', reference);
      expect(await errorCode(deposit(alice, 'cGHS', '701', reference))).toBe(
        'UNIQUE_REFERENCE_REUSED',
      );
      expect(await errorCode(deposit(bob, 'cGHS', '700', reference))).toBe(
        'UNIQUE_REFERENCE_REUSED',
      );
    });

    it('processes concurrent identical requests exactly once', async () => {
      const reference = h.reference();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => deposit(alice, 'EURx', '250', reference)),
      );
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect((result.reason as AppError).code).toBe('TRANSACTION_IN_PROGRESS');
        }
      }
      expect(h.balance(alice, 'EURx')).toBe(250n);
      expect(h.repository.rows.size).toBe(1);
    });

    it('answers 409 while the original request is still in flight', async () => {
      const reference = h.reference();
      const original = h.ledger.submitTransfers.bind(h.ledger);
      jest.spyOn(h.ledger, 'submitTransfers').mockRejectedValueOnce(new Error('connection reset'));

      expect(await errorCode(deposit(alice, 'USDx', '100', reference))).toBe('TRANSACTION_PENDING');
      expect(await errorCode(deposit(alice, 'USDx', '100', reference))).toBe(
        'TRANSACTION_IN_PROGRESS',
      );
      jest.spyOn(h.ledger, 'submitTransfers').mockImplementation(original);
    });

    it('resumes an abandoned pending transaction on retry', async () => {
      const reference = h.reference();
      jest.spyOn(h.ledger, 'submitTransfers').mockRejectedValueOnce(new Error('connection reset'));

      expect(await errorCode(deposit(alice, 'USDx', '100', reference))).toBe('TRANSACTION_PENDING');
      const [pending] = [...h.repository.rows.values()];
      expect(pending!.status).toBe('PENDING');
      expect(h.balance(alice, 'USDx')).toBe(0n);

      h.repository.age(pending!._id, 5_000);
      const resumed = await deposit(alice, 'USDx', '100', reference);
      expect(resumed.http_status).toBe(201);
      expect(h.balance(alice, 'USDx')).toBe(100n);
    });

    it('does not double-apply when the ledger committed but the finalization was lost', async () => {
      const reference = h.reference();
      // The ledger applies the transfer, then the process "crashes" before finalizing.
      jest.spyOn(h.repository, 'finalize').mockRejectedValueOnce(new Error('mongo down'));
      await expect(deposit(alice, 'USDx', '100', reference)).rejects.toThrow('mongo down');
      expect(h.balance(alice, 'USDx')).toBe(100n);

      const [pending] = [...h.repository.rows.values()];
      h.repository.age(pending!._id, 5_000);
      const resumed = await deposit(alice, 'USDx', '100', reference);
      expect(resumed.http_status).toBe(201);
      expect(h.balance(alice, 'USDx')).toBe(100n);
    });
  });

  describe('concurrency', () => {
    it('never overdraws under concurrent transfers from the same balance', async () => {
      await deposit(alice, 'USDx', '1000');
      const results = await Promise.all(
        Array.from({ length: 25 }, () =>
          h.service.create({
            type: 'TRANSFER',
            unique_reference: h.reference(),
            source_wallet_id: alice,
            destination_wallet_id: bob,
            source_currency: 'USDx',
            amount: '100',
          }),
        ),
      );

      expect(results.filter((r) => r.http_status === 201)).toHaveLength(10);
      expect(results.filter((r) => r.http_status === 422)).toHaveLength(15);
      expect(h.balance(alice, 'USDx')).toBe(0n);
      expect(h.balance(bob, 'USDx')).toBe(1000n);
      expectLedgersBalanced();
    });

    it('never overdraws under concurrent cross-currency swaps', async () => {
      await deposit(alice, 'cNGN', '1500000'); // 15,000.00 NGN
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          h.service.create({
            type: 'SWAP',
            unique_reference: h.reference(),
            source_wallet_id: alice,
            source_currency: 'cNGN',
            destination_currency: 'EURx',
            amount: '150000',
          }),
        ),
      );
      expect(results.filter((r) => r.http_status === 201)).toHaveLength(10);
      expect(h.balance(alice, 'cNGN')).toBe(0n);
      expectLedgersBalanced();
    });
  });

  it('runs finalization hooks once per transaction', async () => {
    const reference = h.reference();
    await deposit(alice, 'cNGN', '1', reference);
    await deposit(alice, 'cNGN', '1', reference);
    expect(h.finalized).toHaveLength(1);
  });

  it('fetches a transaction by id', async () => {
    const res = await deposit(alice, 'cNGN', '1');
    const id = (res.body as Body).data.id as string;
    await expect(h.service.get(id)).resolves.toMatchObject({ _id: id, status: 'COMPLETED' });
    expect(await errorCode(h.service.get('missing'))).toBe('TRANSACTION_NOT_FOUND');
  });
});
