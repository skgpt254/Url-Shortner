import { Queue } from 'bullmq';
import { queueConnection } from './connection.js';
import { logger } from '../lib/logger.js';

export interface ClickEventJob {
  linkId: string;
  clickedAt: string; // ISO timestamp, captured at request time not job-processing time
  ip: string; // raw IP — hashed inside the worker, never persisted raw (see analytics.service.ts)
  userAgent: string | null;
  referrer: string | null;
}

export const clickQueue = new Queue<ClickEventJob>('click-events', {
  ...queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 500 },
    removeOnComplete: { count: 10_000 }, // cap memory; we don't need completed-job history
    removeOnFail: { count: 50_000 }, // keep more failed jobs around for debugging
  },
});

/**
 * Fire-and-forget enqueue. Deliberately swallows errors: click tracking
 * must NEVER be able to fail or slow down a redirect. Worst case we lose
 * one analytics data point, which is an acceptable tradeoff for a redirect
 * service whose entire job is "respond as fast as possible."
 */
export function enqueueClickEvent(job: ClickEventJob): void {
  clickQueue.add('record-click', job).catch((err) => {
    logger.warn({ err, linkId: job.linkId }, 'Failed to enqueue click event (non-fatal)');
  });
}
