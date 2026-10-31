import { Logger } from '@nestjs/common';
import type { Client } from 'tigerbeetle-node';

/** The subset of the TigerBeetle client the ledger uses. */
export type LedgerClient = Pick<
  Client,
  'createAccounts' | 'createTransfers' | 'lookupAccounts' | 'lookupTransfers' | 'destroy'
>;

export interface TigerBeetleConnectionOptions {
  /** Resolves the configured address (possibly a hostname) to `ip:port`. */
  resolve: () => Promise<string>;
  /** Creates a client for a resolved `ip:port`. */
  connect: (address: string) => LedgerClient;
  /** Bound on every request: the client retries forever when the replica is unreachable. */
  requestTimeoutMs: number;
}

/**
 * Keeps a TigerBeetle client pointed at the current address of the replica. The client only
 * accepts IPs, so a hostname is resolved up front; if the replica moves (e.g. its container
 * is recreated and gets a new IP), requests time out or fail. On any failure the hostname is
 * resolved again and, if the IP changed, the client is replaced. The failed request is still
 * rejected: money movement is idempotent and pending work is retried by the caller or the
 * reconciler.
 */
export class TigerBeetleConnection implements LedgerClient {
  private readonly logger = new Logger('TigerBeetle');
  private recheck: Promise<void> | null = null;

  private constructor(
    private client: LedgerClient,
    private address: string,
    private readonly options: TigerBeetleConnectionOptions,
  ) {}

  static async open(options: TigerBeetleConnectionOptions): Promise<TigerBeetleConnection> {
    const address = await options.resolve();
    new Logger('TigerBeetle').log(`Connecting to replica at ${address}`);
    return new TigerBeetleConnection(options.connect(address), address, options);
  }

  get currentAddress(): string {
    return this.address;
  }

  createAccounts: LedgerClient['createAccounts'] = (batch) =>
    this.run((client) => client.createAccounts(batch));

  createTransfers: LedgerClient['createTransfers'] = (batch) =>
    this.run((client) => client.createTransfers(batch));

  lookupAccounts: LedgerClient['lookupAccounts'] = (ids) =>
    this.run((client) => client.lookupAccounts(ids));

  lookupTransfers: LedgerClient['lookupTransfers'] = (ids) =>
    this.run((client) => client.lookupTransfers(ids));

  destroy(): void {
    this.client.destroy();
  }

  /** Re-resolves the address once at a time; concurrent failures share the same check. */
  recheckAddress(): Promise<void> {
    this.recheck ??= this.reconnectIfMoved().finally(() => {
      this.recheck = null;
    });
    return this.recheck;
  }

  private async run<T>(request: (client: LedgerClient) => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`TigerBeetle request timed out after ${this.options.requestTimeoutMs}ms`),
          ),
        this.options.requestTimeoutMs,
      );
    });
    try {
      return await Promise.race([request(this.client), timeout]);
    } catch (error) {
      void this.recheckAddress();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async reconnectIfMoved(): Promise<void> {
    let address: string;
    try {
      address = await this.options.resolve();
    } catch (error) {
      this.logger.warn(`Could not resolve the replica address: ${(error as Error).message}`);
      return;
    }
    if (address === this.address) {
      return;
    }
    this.logger.warn(`Replica moved from ${this.address} to ${address}; reconnecting`);
    const previous = this.client;
    this.client = this.options.connect(address);
    this.address = address;
    try {
      previous.destroy();
    } catch (error) {
      this.logger.warn(`Could not close the previous client: ${(error as Error).message}`);
    }
  }
}
