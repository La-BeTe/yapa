import type { JobsRegistry } from '../jobs/jobs.registry';
import { AuditPublisher, auditJobId } from './audit.publisher';

describe('AuditPublisher', () => {
  it('enqueues one deduplicated job per event', async () => {
    const enqueue = jest.fn().mockResolvedValue('1');
    const publisher = new AuditPublisher({ enqueue } as unknown as JobsRegistry);

    await publisher.publish([
      { wallet_id: 'W1', event: 'TRANSFER_SENT', transaction_id: 'T1' },
      { wallet_id: 'W2', event: 'TRANSFER_RECEIVED', transaction_id: 'T1' },
    ]);

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      'audit-log',
      expect.objectContaining({ wallet_id: 'W1', occurred_at: expect.any(String) }),
      { jobId: 'audit-W1-TRANSFER_SENT-T1' },
    );
  });

  it('never throws when the queue is unavailable', async () => {
    const enqueue = jest.fn().mockRejectedValue(new Error('redis down'));
    const publisher = new AuditPublisher({ enqueue } as unknown as JobsRegistry);
    await expect(
      publisher.publish([{ wallet_id: 'W1', event: 'WALLET_CREATED' }]),
    ).resolves.toBeUndefined();
  });

  it('builds bullmq-compatible job ids', () => {
    const id = auditJobId({ wallet_id: 'W1', event: 'WALLET_CREATED' });
    expect(id).toBe('audit-W1-WALLET_CREATED-none');
    expect(id).not.toContain(':');
  });
});
