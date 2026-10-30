import { resolve } from 'node:path';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

declare global {
  var __E2E_CONTAINERS__: StartedTestContainer[] | undefined;
}

/**
 * Starts real MongoDB, Redis and TigerBeetle containers once for the whole e2e run and
 * exposes their addresses through environment variables inherited by the test workers.
 */
export default async function globalSetup(): Promise<void> {
  const tigerbeetleImage = await GenericContainer.fromDockerfile(
    resolve(__dirname, '../../docker/tigerbeetle'),
  ).build('yapa-tigerbeetle:test', { deleteOnExit: false });

  const [mongo, redis, tigerbeetle] = await Promise.all([
    new GenericContainer('mongo:7')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withCommand(['redis-server', '--maxmemory-policy', 'noeviction'])
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    tigerbeetleImage
      .withExposedPorts(3000)
      // io_uring is blocked by Docker's default seccomp profile, and TigerBeetle locks memory.
      .withSecurityOpt('seccomp=unconfined')
      .withAddedCapabilities('IPC_LOCK')
      .withUlimits({ memlock: { hard: -1, soft: -1 } })
      .withWaitStrategy(Wait.forListeningPorts())
      .withStartupTimeout(120_000)
      .start(),
  ]);

  globalThis.__E2E_CONTAINERS__ = [mongo, redis, tigerbeetle];
  process.env.E2E_MONGO_URL = `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}`;
  process.env.E2E_REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.E2E_TB_ADDRESS = `${tigerbeetle.getHost()}:${tigerbeetle.getMappedPort(3000)}`;
}
