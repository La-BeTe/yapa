import { newId } from '../../src/common/ids/ulid';
import type { TransactionRecord } from '../../src/transactions/transaction.types';
import { createE2eApp, eventually, type E2eApp } from './e2e-app';

describe('Logs, audit and reconciliation (e2e)', () => {
  let ctx: E2eApp;
  let walletId: string;

  beforeAll(async () => {
    ctx = await createE2eApp('operations', { RECONCILER_STALE_AFTER_MS: '1000' });
    walletId = (await ctx.http.post('/v1/wallets').send({ email: 'ops@example.com' })).body.data.id;
  });

  afterAll(() => ctx.close());

  it('records each request and its response under the X-Request-Id', async () => {
    const requestId = newId();
    await ctx.http
      .post('/v1/transactions')
      .set('x-request-id', requestId)
      .set('x-admin-key', 'should-be-redacted')
      .send({
        type: 'DEPOSIT',
        unique_reference: 'ops-1',
        destination_wallet_id: walletId,
        currency: 'cGHS',
        amount: '100',
      })
      .expect(201)
      .expect('x-request-id', requestId);

    const log = await eventually(async () => {
      const found = await ctx.mongo.collection('request_logs').findOne({ request_id: requestId });
      expect(found).not.toBeNull();
      return found!;
    });
    expect(log).toMatchObject({
      method: 'POST',
      path: '/v1/transactions',
      body: { unique_reference: 'ops-1', amount: '100' },
      response_status: 201,
      response_body: { status: 'success', data: { unique_reference: 'ops-1' } },
      headers: { 'x-admin-key': '[REDACTED]' },
    });
  });

  it('writes wallet audit events through the audit worker', async () => {
    await eventually(async () => {
      const events = await ctx.mongo
        .collection('audit_logs')
        .find({ wallet_id: walletId })
        .map((e) => e.event as string)
        .toArray();
      expect(events).toEqual(
        expect.arrayContaining(['WALLET_CREATED', 'WALLET_ACTIVATED', 'DEPOSIT_COMPLETED']),
      );
    });
  });

  it('lists the registered workers', async () => {
    const res = await ctx.http.get('/v1/admin/jobs').set('x-admin-key', ctx.adminKey).expect(200);
    expect((res.body.data as Array<{ name: string }>).map((j) => j.name).sort()).toEqual([
      'audit-log',
      'fx-refresh',
      'reconciler',
      'request-log',
    ]);
  });

  it('reconciles a transaction left pending between MongoDB and TigerBeetle', async () => {
    // Simulate a crash after the PENDING record was written but before the ledger call:
    // reuse the stored legs of a real transaction under a fresh id and reference.
    const transactions = ctx.mongo.collection<TransactionRecord>('transactions');
    const template = await transactions.findOne({ unique_reference: 'ops-1' });
    const pendingId = newId();
    await transactions.insertOne({
      ...template!,
      _id: pendingId,
      unique_reference: 'ops-crashed',
      request_hash: 'n/a',
      status: 'PENDING',
      response: null,
      completed_at: null,
      ledger_transfers: template!.ledger_transfers.map((leg) => ({ ...leg, id: newId() })),
      updated_at: new Date(Date.now() - 60_000),
    });

    await ctx.http
      .post('/v1/admin/jobs/reconciler/trigger')
      .set('x-admin-key', ctx.adminKey)
      .send({})
      .expect(202);

    await eventually(async () => {
      const res = await ctx.http.get(`/v1/transactions/${pendingId}`).expect(200);
      expect(res.body.data.status).toBe('COMPLETED');
    });
    const wallet = await ctx.http.get(`/v1/wallets/${walletId}`).expect(200);
    const balances = wallet.body.data.balances as Array<{ currency: string; amount: string }>;
    expect(balances.find((b) => b.currency === 'cGHS')?.amount).toBe('200');
  });
});
