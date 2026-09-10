/**
 * Runs as an independent process/container from the API server
 * (see docker-compose.yml / k8s/worker-deployment.yaml). This separation
 * matters operationally: a burst of click-processing backlog should never
 * be able to starve CPU/memory away from the latency-critical redirect
 * path, and the two scale independently (many API replicas behind a load
 * balancer, a smaller pool of worker replicas sized to sustained click
 * throughput).
 *
 * For free-tier deployments without a background-worker service type
 * (e.g. Render's free tier), see EMBED_WORKER in server.ts instead.
 */
import { logger } from '../lib/logger.js';
import { closeDbPool } from '../db/client.js';
import { closeRedis } from '../lib/cache.js';
import { startClickWorker } from './click-worker.js';

const worker = startClickWorker();

async function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down gracefully...');
  await worker.close();
  await closeDbPool();
  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
