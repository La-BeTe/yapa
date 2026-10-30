import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppExceptionFilter } from './app-exception.filter';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { createValidationPipe } from './validation.pipe';

export const API_PREFIX = 'v1';

/** Applies the HTTP conventions shared by the real server and the e2e test app. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
  return app;
}
