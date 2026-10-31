import type { LedgerClient } from './tigerbeetle.connection';
import { TigerBeetleConnection } from './tigerbeetle.connection';

/** A client bound to one address; `hang` makes every request wait forever, like an unreachable replica. */
class FakeClient implements LedgerClient {
  destroyed = false;
  hang = false;

  constructor(readonly address: string) {}

  private reply<T>(value: T): Promise<T> {
    return this.hang ? new Promise<T>(() => {}) : Promise.resolve(value);
  }

  createAccounts = () => this.reply([]);
  createTransfers = () => this.reply([]);
  lookupAccounts = () => this.reply([]);
  lookupTransfers = () => this.reply([]);
  destroy = () => {
    this.destroyed = true;
  };
}

describe('TigerBeetleConnection', () => {
  let resolved: string;
  let resolutions: number;
  let clients: FakeClient[];
  let connection: TigerBeetleConnection;

  beforeEach(async () => {
    resolved = '10.0.0.2:3000';
    resolutions = 0;
    clients = [];
    connection = await TigerBeetleConnection.open({
      resolve: () => {
        resolutions++;
        return Promise.resolve(resolved);
      },
      connect: (address) => {
        const client = new FakeClient(address);
        clients.push(client);
        return client;
      },
      requestTimeoutMs: 50,
    });
  });

  it('forwards requests to the client for the resolved address', async () => {
    await expect(connection.lookupAccounts([1n])).resolves.toEqual([]);
    expect(clients.map((c) => c.address)).toEqual(['10.0.0.2:3000']);
  });

  it('times out a hung request and reconnects when the replica has moved', async () => {
    clients[0]!.hang = true;
    resolved = '10.0.0.9:3000';

    await expect(connection.lookupAccounts([1n])).rejects.toThrow(/timed out after 50ms/);
    await connection.recheckAddress();

    expect(connection.currentAddress).toBe('10.0.0.9:3000');
    expect(clients[0]!.destroyed).toBe(true);
    await expect(connection.lookupAccounts([1n])).resolves.toEqual([]);
    expect(clients).toHaveLength(2);
  });

  it('keeps the client when the address has not changed', async () => {
    clients[0]!.hang = true;

    await expect(connection.createTransfers([])).rejects.toThrow(/timed out/);
    await connection.recheckAddress();

    expect(clients).toHaveLength(1);
    expect(clients[0]!.destroyed).toBe(false);
  });

  it('reconnects once for many concurrent failures', async () => {
    clients[0]!.hang = true;
    resolved = '10.0.0.9:3000';

    const failures = await Promise.allSettled(
      Array.from({ length: 5 }, () => connection.lookupTransfers([1n])),
    );
    await connection.recheckAddress();

    expect(failures.every((f) => f.status === 'rejected')).toBe(true);
    expect(clients).toHaveLength(2);
    expect(clients[0]!.destroyed).toBe(true);
  });

  it('keeps the current client when the address cannot be resolved', async () => {
    resolutions = 0;
    connection = await TigerBeetleConnection.open({
      resolve: () =>
        resolutions++ === 0 ? Promise.resolve(resolved) : Promise.reject(new Error('ENOTFOUND')),
      connect: (address) => {
        const client = new FakeClient(address);
        clients.push(client);
        return client;
      },
      requestTimeoutMs: 50,
    });
    const current = clients.at(-1)!;
    current.hang = true;

    await expect(connection.lookupAccounts([1n])).rejects.toThrow(/timed out/);
    await connection.recheckAddress();

    expect(current.destroyed).toBe(false);
    expect(connection.currentAddress).toBe('10.0.0.2:3000');
  });
});
