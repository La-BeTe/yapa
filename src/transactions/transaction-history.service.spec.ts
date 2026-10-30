import { createMoneyHarness, type MoneyHarness } from '../../test/support/money-harness';
import { AppError } from '../common/http/app-error';

describe('TransactionHistoryService', () => {
  let h: MoneyHarness;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    h = await createMoneyHarness();
    alice = await h.createWallet();
    bob = await h.createWallet();

    // alice: deposit cNGN, deposit USDx, swap cNGN->USDx, send USDx to bob, receive cGHS from bob
    await h.service.create({
      type: 'DEPOSIT',
      unique_reference: 'd1',
      destination_wallet_id: alice,
      currency: 'cNGN',
      amount: '300000',
    });
    await h.service.create({
      type: 'DEPOSIT',
      unique_reference: 'd2',
      destination_wallet_id: alice,
      currency: 'USDx',
      amount: '5000',
    });
    await h.service.create({
      type: 'SWAP',
      unique_reference: 's1',
      source_wallet_id: alice,
      source_currency: 'cNGN',
      destination_currency: 'USDx',
      amount: '150000',
    });
    await h.service.create({
      type: 'TRANSFER',
      unique_reference: 't1',
      source_wallet_id: alice,
      destination_wallet_id: bob,
      source_currency: 'USDx',
      amount: '1000',
    });
    await h.service.create({
      type: 'DEPOSIT',
      unique_reference: 'd3',
      destination_wallet_id: bob,
      currency: 'cGHS',
      amount: '9000',
    });
    await h.service.create({
      type: 'TRANSFER',
      unique_reference: 't2',
      source_wallet_id: bob,
      destination_wallet_id: alice,
      source_currency: 'cGHS',
      amount: '4000',
    });
  });

  const refs = (page: { items: Array<{ unique_reference: string }> }) =>
    page.items.map((i) => i.unique_reference);

  it('lists deposits, swaps and transfers sent and received, newest first', async () => {
    const page = await h.history.list(alice, {});
    expect(refs(page)).toEqual(['t2', 't1', 's1', 'd2', 'd1']);
    expect(page.items.map((i) => i.direction)).toEqual(['IN', 'OUT', 'SELF', 'IN', 'IN']);
    expect(page.next_cursor).toBeNull();
  });

  it('filters by type and by currency on either side', async () => {
    expect(refs(await h.history.list(alice, { type: 'TRANSFER' }))).toEqual(['t2', 't1']);
    expect(refs(await h.history.list(alice, { currency: 'USDx' }))).toEqual(['t1', 's1', 'd2']);
    expect(refs(await h.history.list(alice, { type: 'DEPOSIT', currency: 'cNGN' }))).toEqual([
      'd1',
    ]);
  });

  it('paginates with an opaque cursor', async () => {
    const first = await h.history.list(alice, { limit: 2 });
    expect(refs(first)).toEqual(['t2', 't1']);
    const second = await h.history.list(alice, { limit: 2, cursor: first.next_cursor! });
    expect(refs(second)).toEqual(['s1', 'd2']);
    const third = await h.history.list(alice, { limit: 2, cursor: second.next_cursor! });
    expect(refs(third)).toEqual(['d1']);
    expect(third.next_cursor).toBeNull();
  });

  it('serves repeated reads from the cache and invalidates when a transaction finalizes', async () => {
    const listSpy = jest.spyOn(h.repository, 'list');
    await h.history.list(alice, {});
    await h.history.list(alice, {});
    expect(listSpy).toHaveBeenCalledTimes(1);

    await h.service.create({
      type: 'DEPOSIT',
      unique_reference: 'd4',
      destination_wallet_id: alice,
      currency: 'EURx',
      amount: '1',
    });
    const page = await h.history.list(alice, {});
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(refs(page)[0]).toBe('d4');
  });

  it('invalidates the counterparty history on transfers', async () => {
    await h.history.list(bob, {});
    await h.service.create({
      type: 'TRANSFER',
      unique_reference: 't3',
      source_wallet_id: alice,
      destination_wallet_id: bob,
      source_currency: 'USDx',
      amount: '1',
    });
    expect(refs(await h.history.list(bob, {}))[0]).toBe('t3');
  });

  it('falls back to the database when the cache is down', async () => {
    h.listCache.failing = true;
    expect(refs(await h.history.list(alice, { limit: 1 }))).toEqual(['t2']);
  });

  it('rejects unknown wallets and malformed cursors', async () => {
    await expect(h.history.list('01JZZZZZZZZZZZZZZZZZZZZZZZ', {})).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
    });
    await expect(h.history.list(alice, { cursor: 'nope' })).rejects.toBeInstanceOf(AppError);
  });
});
