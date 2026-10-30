import { createMoneyHarness, type MoneyHarness } from '../../test/support/money-harness';
import type { AuditPublisher } from '../audit/audit.publisher';
import type { AppConfigService } from '../config/app-config.service';
import { validateEnv } from '../config/env.schema';
import type { WalletsService } from '../wallets/wallets.service';
import { ReconcilerWorker } from './reconciler.worker';

describe('ReconcilerWorker', () => {
  let h: MoneyHarness;
  let alice: string;
  let worker: ReconcilerWorker;
  const wallets = {
    findStaleProvisioning: jest.fn().mockResolvedValue([]),
    activate: jest.fn(),
  };

  beforeEach(async () => {
    h = await createMoneyHarness({ RECONCILER_STALE_AFTER_MS: '1000' });
    alice = await h.createWallet();
    const env = validateEnv({ RECONCILER_STALE_AFTER_MS: '1000', RECONCILER_EVERY_MS: '30000' });
    const audit = { publish: (entries: never[]) => (h.audits.push(...entries), Promise.resolve()) };
    worker = new ReconcilerWorker(
      h.repository,
      h.executor,
      wallets as unknown as WalletsService,
      audit as unknown as AuditPublisher,
      { get: (key: keyof typeof env) => env[key] } as AppConfigService,
    );
    wallets.findStaleProvisioning.mockResolvedValue([]);
    wallets.activate.mockReset();
  });

  const depositThatStallsBeforeLedger = async () => {
    jest.spyOn(h.ledger, 'submitTransfers').mockRejectedValueOnce(new Error('connection reset'));
    await h.service
      .create({
        type: 'DEPOSIT',
        unique_reference: h.reference(),
        destination_wallet_id: alice,
        currency: 'USDx',
        amount: '500',
      })
      .catch(() => undefined);
    return [...h.repository.rows.values()].at(-1)!;
  };

  it('schedules itself from configuration', () => {
    expect(worker.schedule()).toEqual({ every: 30000 });
  });

  it('completes stale pending transactions that never reached the ledger', async () => {
    const pending = await depositThatStallsBeforeLedger();
    h.repository.age(pending._id, 5_000);

    const summary = await worker.process();

    expect(summary.transactions).toEqual({ finalized: 1, still_pending: 0 });
    expect(h.repository.rows.get(pending._id)?.status).toBe('COMPLETED');
    expect(h.balance(alice, 'USDx')).toBe(500n);
    expect(h.audits).toContainEqual(
      expect.objectContaining({ event: 'TRANSACTION_RECONCILED', transaction_id: pending._id }),
    );
  });

  it('finalizes transactions the ledger applied without moving money again', async () => {
    jest.spyOn(h.repository, 'finalize').mockRejectedValueOnce(new Error('mongo down'));
    await h.service
      .create({
        type: 'DEPOSIT',
        unique_reference: h.reference(),
        destination_wallet_id: alice,
        currency: 'USDx',
        amount: '500',
      })
      .catch(() => undefined);
    const pending = [...h.repository.rows.values()].at(-1)!;
    expect(h.balance(alice, 'USDx')).toBe(500n);
    h.repository.age(pending._id, 5_000);

    await worker.process();

    expect(h.repository.rows.get(pending._id)?.status).toBe('COMPLETED');
    expect(h.balance(alice, 'USDx')).toBe(500n);
  });

  it('leaves fresh pending transactions alone', async () => {
    const pending = await depositThatStallsBeforeLedger();
    const summary = await worker.process();
    expect(summary.transactions.finalized).toBe(0);
    expect(h.repository.rows.get(pending._id)?.status).toBe('PENDING');
  });

  it('keeps transactions pending while the ledger is still unreachable', async () => {
    const pending = await depositThatStallsBeforeLedger();
    h.repository.age(pending._id, 5_000);
    jest.spyOn(h.ledger, 'submitTransfers').mockRejectedValueOnce(new Error('still down'));

    const summary = await worker.process();
    expect(summary.transactions).toEqual({ finalized: 0, still_pending: 1 });
    expect(h.repository.rows.get(pending._id)?.status).toBe('PENDING');
  });

  it('activates wallets stuck in provisioning', async () => {
    wallets.findStaleProvisioning.mockResolvedValue([{ _id: 'W1' }, { _id: 'W2' }]);
    wallets.activate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('ledger down'));
    const summary = await worker.process();
    expect(summary.wallets).toEqual({ activated: 1, still_provisioning: 1 });
  });
});
