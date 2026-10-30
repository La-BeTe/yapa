import { Logger, Provider } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createClient } from 'tigerbeetle-node';
import { AppConfigService } from '../config/app-config.service';
import { TIGERBEETLE_CLIENT } from './ledger.constants';

/**
 * The TigerBeetle client only accepts IP addresses, so hostnames such as the
 * docker compose service name are resolved first.
 */
export async function resolveReplicaAddress(address: string): Promise<string> {
  if (/^\d+$/.test(address)) {
    return address;
  }
  const separator = address.lastIndexOf(':');
  const host = separator === -1 ? address : address.slice(0, separator);
  const port = separator === -1 ? '3001' : address.slice(separator + 1);
  if (isIP(host)) {
    return `${host}:${port}`;
  }
  const { address: ip } = await lookup(host, { family: 4 });
  return `${ip}:${port}`;
}

export const tigerBeetleClientProvider: Provider = {
  provide: TIGERBEETLE_CLIENT,
  inject: [AppConfigService],
  useFactory: async (config: AppConfigService) => {
    const address = await resolveReplicaAddress(config.get('TB_ADDRESS'));
    new Logger('TigerBeetle').log(`Connecting to replica at ${address}`);
    return createClient({
      cluster_id: config.get('TB_CLUSTER_ID'),
      replica_addresses: [address],
    });
  },
};
