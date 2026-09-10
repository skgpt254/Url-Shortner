import { buildApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { closeDbPool } from './db/client.js';
import { closeRedis } from './lib/cache.js';
import { startClickWorker } from './queue/click-worker.js';
import type { Worker } from 'bullmq';
import type { ClickEventJob } from './queue/click-queue.js';

async function main() {
  const app = await buildApp();

  await app.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, env: config.env }, 'Shortlink API server started');

  // Optional: run the click-analytics worker inside this same process
  // rather than as a separate service. This exists for free-tier hosting
  // platforms that only offer one free "web service" slot and no free
  // background-worker type (Render's free tier is the motivating case —
  // see README's deployment section). It sacrifices the architectural
  // separation described throughout this codebase (a click-processing
  // burst CAN now compete with redirect-serving CPU/memory) — only ever
  // enable this for small-scale/free deployments, never a real multi-
  // replica production setup, where every replica would double as a
  // queue consumer.
  let embeddedWorker: Worker<ClickEventJob> | null = null;
  if (process.env.EMBED_WORKER === 'true') {
    embeddedWorker = startClickWorker();
    logger.warn(
      'EMBED_WORKER=true: running the click-analytics worker inside the API process. ' +
        'This is intended for free-tier/small-scale deployments only — see README.'
    );
  }

  // ── Graceful shutdown ────────────────────────────────────────────────
  // On SIGTERM (the signal k8s/most orchestrators send before killing a
  // pod), stop accepting new connections, let in-flight requests finish,
  // then close DB/Redis connections cleanly. Without this, a rolling
  // deploy can drop in-flight redirects or leave dangling DB connections
  // that the pool never releases.
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Received shutdown signal, closing gracefully...');

    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 10s, forcing exit.');
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    try {
      await app.close(); // stops accepting new connections, waits for in-flight requests
      if (embeddedWorker) await embeddedWorker.close();
      await closeDbPool();
      await closeRedis();
      logger.info('Shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
