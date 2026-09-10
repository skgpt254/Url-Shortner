import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Single place that decides how internal errors become HTTP responses.
 * Deliberately never leaks stack traces or internal error messages for
 * *unexpected* errors (only for AppError subclasses, which are safe by
 * construction since we wrote their messages ourselves) — this prevents
 * accidental information disclosure (DB connection strings, internal file
 * paths, library internals) to API consumers.
 */
export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error, reqId: request.id }, error.message);
    } else {
      logger.warn({ code: error.code, reqId: request.id }, error.message);
    }
    reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(422).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: error.flatten(),
      },
    });
    return;
  }

  // Fastify's own errors (malformed JSON body, payload too large, etc.)
  // carry a statusCode we should respect.
  const fastifyErr = error as FastifyError;
  if (typeof fastifyErr.statusCode === 'number' && fastifyErr.statusCode < 500) {
    reply.status(fastifyErr.statusCode).send({
      error: { code: fastifyErr.code ?? 'BAD_REQUEST', message: fastifyErr.message },
    });
    return;
  }

  // Anything else is unexpected: log full detail server-side, return an
  // opaque message to the client.
  logger.error({ err: error, reqId: request.id }, 'Unhandled error');
  reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
}
