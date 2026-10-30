import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { Envelope, success } from './envelope';
import { RESPONSE_MESSAGE } from './response-message.decorator';

/** Marks a handler result as an already-built envelope (e.g. an idempotent replay). */
export class RawEnvelope<T> {
  constructor(readonly envelope: Envelope<T>) {}
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const message =
      this.reflector.getAllAndOverride<string | undefined>(RESPONSE_MESSAGE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'OK';

    return next
      .handle()
      .pipe(
        map((body: unknown) =>
          body instanceof RawEnvelope ? body.envelope : success(message, body ?? null),
        ),
      );
  }
}
