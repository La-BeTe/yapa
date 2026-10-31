import { createE2eApp, type E2eApp } from './e2e-app';

describe('Transactions (e2e)', () => {
  let ctx: E2eApp;
  let alice: string;
  let bob: string;
  let refs = 0;
  const ref = () => `e2e-${Date.now()}-${++refs}`;

  beforeAll(async () => {
    ctx = await createE2eApp('transactions');
    alice = (await ctx.http.post('/v1/wallets').send({ email: 'alice@example.com' })).body.data.id;
    bob = (await ctx.http.post('/v1/wallets').send({ email: 'bob@example.com' })).body.data.id;
  });

  afterAll(() => ctx.close());

  const post = (body: Record<string, unknown>) => ctx.http.post('/v1/transactions').send(body);
  const balances = async (walletId: string) => {
    const res = await ctx.http.get(`/v1/wallets/${walletId}`).expect(200);
    return Object.fromEntries(
      (res.body.data.balances as Array<{ currency: string; amount: string }>).map((b) => [
        b.currency,
        b.amount,
      ]),
    );
  };

  it('deposits, swaps and transfers across currencies', async () => {
    const deposit = await post({
      type: 'DEPOSIT',
      unique_reference: ref(),
      destination_wallet_id: alice,
      currency: 'cNGN',
      amount: '1500000',
    }).expect(201);
    expect(deposit.body).toMatchObject({
      status: 'success',
      message: 'Transaction completed',
      data: {
        type: 'DEPOSIT',
        status: 'COMPLETED',
        destination: { wallet_id: alice, amount: '1500000' },
      },
    });

    // 7,500.00 NGN at 1/1500 = 5.00 USD -> 500; 50 bps fee floors to 2 -> 498.
    const swap = await post({
      type: 'SWAP',
      unique_reference: ref(),
      source_wallet_id: alice,
      source_currency: 'cNGN',
      destination_currency: 'USDx',
      amount: '750000',
    }).expect(201);
    expect(swap.body.data).toMatchObject({
      destination: { amount: '498', currency: 'USDx' },
      fx: { spread_bps: 50, fee_amount: '2', rate_source: 'live' },
    });

    // 4.00 USD at 12.5 = 50.00 GHS -> 5000; fee 25 -> 4975.
    const transfer = await post({
      type: 'TRANSFER',
      unique_reference: ref(),
      source_wallet_id: alice,
      destination_wallet_id: bob,
      source_currency: 'USDx',
      destination_currency: 'cGHS',
      amount: '400',
    }).expect(201);
    expect(transfer.body.data).toMatchObject({
      source: { wallet_id: alice, amount: '400', currency: 'USDx' },
      destination: { wallet_id: bob, amount: '4975', currency: 'cGHS' },
      fx: { mid_rate: '12.5' },
    });

    expect(await balances(alice)).toMatchObject({ cNGN: '750000', USDx: '98' });
    expect(await balances(bob)).toMatchObject({ cGHS: '4975' });

    const wallet = await ctx.http.get(`/v1/wallets/${alice}`).expect(200);
    // 7,500.00 NGN = 5.00 USD, plus 0.98 USD
    expect(wallet.body.data.total_usd).toEqual({ currency: 'USDx', amount: '598', scale: 2 });

    const fetched = await ctx.http.get(`/v1/transactions/${transfer.body.data.id}`).expect(200);
    expect(fetched.body.data).toEqual(transfer.body.data);
  });

  it('rejects overdrafts and records the failure', async () => {
    const res = await post({
      type: 'TRANSFER',
      unique_reference: ref(),
      source_wallet_id: bob,
      destination_wallet_id: alice,
      source_currency: 'EURx',
      amount: '1',
    }).expect(422);
    expect(res.body).toMatchObject({
      status: 'error',
      data: { code: 'INSUFFICIENT_FUNDS', details: { transaction_id: expect.any(String) } },
    });
    const failed = await ctx.http
      .get(`/v1/transactions/${res.body.data.details.transaction_id}`)
      .expect(200);
    expect(failed.body.data).toMatchObject({
      status: 'FAILED',
      failure: { code: 'INSUFFICIENT_FUNDS' },
    });
  });

  it('is idempotent on unique_reference', async () => {
    const body = {
      type: 'DEPOSIT',
      unique_reference: ref(),
      destination_wallet_id: bob,
      currency: 'EURx',
      amount: '1234',
    };
    const first = await post(body).expect(201);
    const second = await post(body).expect(201);
    expect(second.body).toEqual(first.body);
    expect((await balances(bob)).EURx).toBe('1234');

    const reused = await post({ ...body, amount: '1235' }).expect(422);
    expect(reused.body.data.code).toBe('UNIQUE_REFERENCE_REUSED');
  });

  it('processes concurrent duplicates once and never overdraws under contention', async () => {
    const carol = (await ctx.http.post('/v1/wallets').send({ email: 'carol@example.com' })).body
      .data.id;
    const dave = (await ctx.http.post('/v1/wallets').send({ email: 'dave@example.com' })).body.data
      .id;
    const depositBody = {
      type: 'DEPOSIT',
      unique_reference: ref(),
      destination_wallet_id: carol,
      currency: 'USDx',
      amount: '1000',
    };
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => post(depositBody)));
    expect(duplicates.every((r) => [201, 409].includes(r.status))).toBe(true);
    expect((await balances(carol)).USDx).toBe('1000');

    const transfers = await Promise.all(
      Array.from({ length: 20 }, () =>
        post({
          type: 'TRANSFER',
          unique_reference: ref(),
          source_wallet_id: carol,
          destination_wallet_id: dave,
          source_currency: 'USDx',
          amount: '100',
        }),
      ),
    );
    expect(transfers.filter((r) => r.status === 201)).toHaveLength(10);
    expect(transfers.filter((r) => r.status === 422)).toHaveLength(10);
    expect((await balances(carol)).USDx).toBe('0');
    expect((await balances(dave)).USDx).toBe('1000');
  });

  it('validates payloads per type', async () => {
    const missing = await post({
      type: 'SWAP',
      unique_reference: ref(),
      source_wallet_id: alice,
      amount: '1',
    }).expect(400);
    expect(missing.body.data.code).toBe('VALIDATION_ERROR');
    await post({
      type: 'DEPOSIT',
      unique_reference: ref(),
      destination_wallet_id: alice,
      currency: 'cNGN',
      amount: '1.5',
    }).expect(400);
    await post({
      type: 'DEPOSIT',
      unique_reference: ref(),
      destination_wallet_id: alice,
      currency: 'BTC',
      amount: '1',
    }).expect(400);
    await post({ type: 'REFUND', unique_reference: ref(), amount: '1' }).expect(400);
  });

  it('lists wallet history newest first with filters and pagination', async () => {
    const history = (query = '') =>
      ctx.http.get(`/v1/transactions?wallet_id=${alice}${query}`).expect(200);

    const page = await history();
    expect(page.body.meta).toEqual({ next_cursor: null, limit: 20 });
    const items = page.body.data as Array<{
      type: string;
      direction: string;
      created_at: string;
    }>;
    expect(items.map((i) => i.type)).toEqual(['TRANSFER', 'TRANSFER', 'SWAP', 'DEPOSIT']);
    expect(items[1]!.direction).toBe('OUT');
    expect([...items].sort((a, b) => b.created_at.localeCompare(a.created_at))).toEqual(items);

    expect((await history('&type=SWAP')).body.data).toHaveLength(1);
    expect((await history('&currency=cGHS')).body.data).toHaveLength(1);

    const first = await history('&limit=3');
    expect(first.body.data).toHaveLength(3);
    expect(first.body.meta).toEqual({ next_cursor: first.body.data[2].id, limit: 3 });
    const second = await history(`&limit=3&cursor=${first.body.meta.next_cursor}`);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta.next_cursor).toBeNull();
  });

  it('requires wallet_id to list transactions', async () => {
    const res = await ctx.http.get('/v1/transactions').expect(400);
    expect(res.body).toMatchObject({ status: 'error', data: { code: 'VALIDATION_ERROR' } });
    await ctx.http.get('/v1/transactions?wallet_id=01JBUNKNOWN0000000000000000').expect(404);
  });

  it('returns source and destination without scale', async () => {
    const res = await ctx.http.get(`/v1/transactions?wallet_id=${alice}&limit=1`).expect(200);
    expect(Object.keys(res.body.data[0].source).sort()).toEqual([
      'amount',
      'currency',
      'wallet_id',
    ]);
  });

  it('reflects new transactions in cached history immediately', async () => {
    await ctx.http.get(`/v1/transactions?wallet_id=${bob}`).expect(200);
    const res = await post({
      type: 'DEPOSIT',
      unique_reference: ref(),
      destination_wallet_id: bob,
      currency: 'cXAF',
      amount: '50',
    }).expect(201);
    const page = await ctx.http.get(`/v1/transactions?wallet_id=${bob}`).expect(200);
    expect(page.body.data[0].id).toBe(res.body.data.id);
  });
});
