import { InMemoryTigerBeetle } from '../../test/support/in-memory-tigerbeetle';
import { AppError } from '../common/http/app-error';
import { newId, ulidToBigInt } from '../common/ids/ulid';
import { AccountCode, TransferCode } from './ledger.constants';
import { LedgerService, LedgerTransferSpec } from './ledger.service';
import { resolveReplicaAddress } from './tigerbeetle.provider';

describe('LedgerService', () => {
  let tb: InMemoryTigerBeetle;
  let ledger: LedgerService;
  const treasury = newId();
  const alice = newId();
  const bob = newId();
  const other = newId();

  beforeEach(async () => {
    tb = new InMemoryTigerBeetle();
    ledger = new LedgerService(tb);
    await ledger.createAccounts([
      { id: treasury, ledger: 1, code: AccountCode.TREASURY, preventOverdraft: false },
      { id: alice, ledger: 1, code: AccountCode.USER, preventOverdraft: true },
      { id: bob, ledger: 1, code: AccountCode.USER, preventOverdraft: true },
      { id: other, ledger: 2, code: AccountCode.USER, preventOverdraft: true },
    ]);
  });

  const leg = (from: string, to: string, amount: bigint, id = newId()): LedgerTransferSpec => ({
    id,
    debitAccountId: from,
    creditAccountId: to,
    amount,
    ledger: 1,
    code: TransferCode.TRANSFER,
    transactionId: newId(),
  });

  it('creates accounts idempotently', async () => {
    await expect(
      ledger.createAccounts([
        { id: alice, ledger: 1, code: AccountCode.USER, preventOverdraft: true },
      ]),
    ).resolves.toBeUndefined();
  });

  it('fails loudly when an account id is reused with different attributes', async () => {
    await expect(
      ledger.createAccounts([
        { id: alice, ledger: 2, code: AccountCode.USER, preventOverdraft: true },
      ]),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('applies transfers and reports balances', async () => {
    await expect(ledger.submitTransfers([leg(treasury, alice, 500n)])).resolves.toEqual({
      ok: true,
    });
    const balances = await ledger.getBalances([alice, treasury]);
    expect(balances.get(alice)).toBe(500n);
    expect(balances.get(treasury)).toBe(-500n);
  });

  it('rejects overdrafts on user accounts', async () => {
    await ledger.submitTransfers([leg(treasury, alice, 100n)]);
    const result = await ledger.submitTransfers([leg(alice, bob, 101n)]);
    expect(result).toMatchObject({
      ok: false,
      failure: 'INSUFFICIENT_FUNDS',
      status: 'exceeds_credits',
    });
    expect((await ledger.getBalances([alice])).get(alice)).toBe(100n);
  });

  it('applies linked legs atomically', async () => {
    await ledger.submitTransfers([leg(treasury, alice, 100n)]);
    // Second leg overdraws bob, so the first leg must be rolled back too.
    const result = await ledger.submitTransfers([leg(alice, bob, 50n), leg(bob, treasury, 80n)]);
    expect(result).toMatchObject({ ok: false, failure: 'INSUFFICIENT_FUNDS', index: 1 });
    const balances = await ledger.getBalances([alice, bob]);
    expect(balances.get(alice)).toBe(100n);
    expect(balances.get(bob)).toBe(0n);
  });

  it('treats resubmission of an applied chain as success without moving money twice', async () => {
    const chain = [leg(treasury, alice, 100n), leg(alice, bob, 40n)];
    await expect(ledger.submitTransfers(chain)).resolves.toEqual({ ok: true });
    await expect(ledger.submitTransfers(chain)).resolves.toEqual({ ok: true });
    const balances = await ledger.getBalances([alice, bob]);
    expect(balances.get(alice)).toBe(60n);
    expect(balances.get(bob)).toBe(40n);
  });

  it('reports ids that already failed', async () => {
    const chain = [leg(alice, bob, 10n)];
    await ledger.submitTransfers(chain);
    await expect(ledger.submitTransfers(chain)).resolves.toMatchObject({
      ok: false,
      failure: 'ALREADY_FAILED',
    });
  });

  it('throws when a transfer id is reused with a different payload', async () => {
    const id = newId();
    await ledger.submitTransfers([leg(treasury, alice, 10n, id)]);
    await expect(ledger.submitTransfers([leg(treasury, alice, 11n, id)])).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('rejects cross-ledger transfers', async () => {
    await expect(ledger.submitTransfers([leg(treasury, other, 10n)])).resolves.toMatchObject({
      ok: false,
      failure: 'REJECTED',
    });
  });

  it('finds which transfers and accounts exist', async () => {
    const applied = leg(treasury, alice, 10n);
    await ledger.submitTransfers([applied]);
    const missing = newId();
    expect(await ledger.findExistingTransfers([applied.id, missing])).toEqual(
      new Set([applied.id]),
    );
    expect(await ledger.findExistingAccounts([alice, missing])).toEqual(new Set([alice]));
  });

  it('links each leg to its business transaction', async () => {
    const spec = leg(treasury, alice, 10n);
    await ledger.submitTransfers([spec]);
    expect(tb.transfers.get(ulidToBigInt(spec.id))?.user_data_128).toBe(
      ulidToBigInt(spec.transactionId),
    );
  });
});

describe('resolveReplicaAddress', () => {
  it('keeps ports and ip addresses as they are', async () => {
    await expect(resolveReplicaAddress('3000')).resolves.toBe('3000');
    await expect(resolveReplicaAddress('10.0.0.5:3000')).resolves.toBe('10.0.0.5:3000');
  });

  it('resolves hostnames to an ipv4 address', async () => {
    await expect(resolveReplicaAddress('localhost:3000')).resolves.toBe('127.0.0.1:3000');
  });
});
