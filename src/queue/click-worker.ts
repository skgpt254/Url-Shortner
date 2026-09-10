import { Worker, type Worker as WorkerType } from 'bullmq';
import { queueConnection } from './connection.js';
import { processClickEvent } from '../modules/analytics/analytics.service.js';
import type { ClickEventJob } from './click-queue.js';
import { logger } from '../lib/logger.js';

/**
 * Starts the BullMQ click-events consumer and returns the Worker instance
 * so the caller can close it during its own shutdown sequence. Shared by:
 *   - queue/worker.process.ts — the standalone worker container (the
 *     production-recommended setup: see k8s/worker-deployment.yaml).
 *   - server.ts, when EMBED_WORKER=true — runs the same consumer inside
 *     the API process itself, trading the architectural separation
 *     described in the README for zero extra cost/infrastructure. This
 *     exists specifically because several free hosting tiers (e.g.
 *     Render's) don't offer a free background-worker service type at
 *     all, only free web services — so a fully free one-click deploy
 *     needs this option. Never enable it in a real multi-replica
 *     production deployment: every replica would independently consume
 *     from the same queue AND independently serve API traffic, defeating
 *     the whole point of the separation (see README "Known limitations").
 */
export function startClickWorker(): WorkerType<ClickEventJob> {
  const concurrency = Number(process.env.CLICK_WORKER_CONCURRENCY ?? 10);

  const worker = new Worker<ClickEventJob>(
    'click-events',
    async (job) => {
      await processClickEvent(job.data);
    },
    { ...queueConnection, concurrency }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Click event processed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Click event processing failed after retries');
  });

  logger.info({ concurrency }, 'Click-event worker started');
  return worker;
}
