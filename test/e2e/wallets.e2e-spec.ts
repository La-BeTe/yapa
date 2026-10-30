import { createE2eApp, type E2eApp } from './e2e-app';

describe('Wallets (e2e)', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createE2eApp('wallets');
  });

  afterAll(() => ctx.close());

  it('reports healthy dependencies', async () => {
    const res = await ctx.http.get('/v1/health').expect(200);
    expect(res.body).toEqual({
      status: 'success',
      message: 'OK',
      data: { healthy: true, checks: { mongo: 'up', redis: 'up', ledger: 'up' } },
    });
  });

  it('creates a wallet with zero balances in every currency', async () => {
    const created = await ctx.http
      .post('/v1/wallets')
      .send({ email: 'Ada@Example.com' })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'success',
      message: 'Wallet created',
      data: { email: 'ada@example.com', phone: null, status: 'ACTIVE' },
    });
    expect(created.headers['x-request-id']).toBeDefined();

    const wallet = await ctx.http.get(`/v1/wallets/${created.body.data.id}`).expect(200);
    expect(wallet.body.data.balances).toEqual([
      { currency: 'cNGN', amount: '0', scale: 2 },
      { currency: 'cGHS', amount: '0', scale: 2 },
      { currency: 'cXAF', amount: '0', scale: 0 },
      { currency: 'USDx', amount: '0', scale: 2 },
      { currency: 'EURx', amount: '0', scale: 2 },
    ]);
    expect(wallet.body.data.total_usd).toEqual({ currency: 'USDx', amount: '0', scale: 2 });

    const accounts = await ctx.mongo
      .collection<{ _id: string; wallet_id: string }>('accounts')
      .find({ wallet_id: created.body.data.id })
      .toArray();
    expect(accounts).toHaveLength(5);
    expect(accounts.every((a) => typeof a._id === 'string' && a._id.length === 26)).toBe(true);
  });

  it('rejects a second wallet for the same email or phone', async () => {
    await ctx.http.post('/v1/wallets').send({ phone: '+234 803 123 4567' }).expect(201);
    const byPhone = await ctx.http
      .post('/v1/wallets')
      .send({ phone: '+2348031234567' })
      .expect(409);
    expect(byPhone.body).toMatchObject({
      status: 'error',
      data: { code: 'WALLET_ALREADY_EXISTS' },
    });

    await ctx.http.post('/v1/wallets').send({ email: 'dup@example.com' }).expect(201);
    await ctx.http.post('/v1/wallets').send({ email: 'DUP@example.com' }).expect(409);
  });

  it('allows only one of many concurrent creations for the same identity', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.http.post('/v1/wallets').send({ email: 'race@example.com' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });

  it('validates input', async () => {
    const empty = await ctx.http.post('/v1/wallets').send({}).expect(400);
    expect(empty.body.data.code).toBe('VALIDATION_ERROR');
    await ctx.http.post('/v1/wallets').send({ email: 'not-an-email' }).expect(400);
    await ctx.http.post('/v1/wallets').send({ phone: '0803' }).expect(400);
  });

  it('returns 404 for unknown wallets', async () => {
    const res = await ctx.http.get('/v1/wallets/01JZZZZZZZZZZZZZZZZZZZZZZZ').expect(404);
    expect(res.body.data.code).toBe('WALLET_NOT_FOUND');
  });
});
