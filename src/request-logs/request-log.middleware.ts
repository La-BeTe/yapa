import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { JobsRegistry } from '../jobs/jobs.registry';
import type { RequestLogEntry } from './request-log.schema';
import { redactHeaders, truncateBody } from './sanitize';
import { REQUEST_LOG_JOB } from './request-log.worker';

/** Swagger UI assets and health probes would only add noise. */
const UNLOGGED_PATHS = ['/docs', '/v1/health'];

/**
 * Captures each request and the response body sent back, then hands the record to the
 * request-log worker. Logging is fire-and-forget: it never delays or fails the request.
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLogMiddleware.name);

  constructor(private readonly jobs: JobsRegistry) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (UNLOGGED_PATHS.some((prefix) => req.originalUrl.startsWith(prefix))) {
      return next();
    }
    let responseBody: unknown = null;
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      responseBody = body;
      return json(body);
    };

    res.on('finish', () => {
      const requestId = req.requestId;
      if (!requestId) {
        return;
      }
      const entry: RequestLogEntry = {
        request_id: requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0] ?? req.originalUrl,
        query: { ...(req.query as Record<string, unknown>) },
        headers: redactHeaders(req.headers),
        body: truncateBody(req.body),
        ip: req.ip ?? null,
        response_status: res.statusCode,
        response_body: truncateBody(responseBody),
        duration_ms: Date.now() - (req.startedAt ?? Date.now()),
        occurred_at: new Date(req.startedAt ?? Date.now()).toISOString(),
      };
      this.jobs
        .enqueue(REQUEST_LOG_JOB, entry, { jobId: `request-log-${requestId}` })
        .catch((error: Error) =>
          this.logger.warn(`Could not enqueue request log: ${error.message}`),
        );
    });

    next();
  }
}
