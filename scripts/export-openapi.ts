import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http/configure-app';
import { buildOpenApiDocument } from '../src/common/http/openapi';

/**
 * Writes docs/openapi.json. Preview mode builds the module graph without running provider
 * factories, so no database, Redis or TigerBeetle connection is needed.
 */
async function main(): Promise<void> {
  const app = configureApp(
    await NestFactory.create(AppModule, { preview: true, abortOnError: false, logger: false }),
  );
  const document = buildOpenApiDocument(app);
  const target = resolve(__dirname, '../docs/openapi.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI spec written to ${target}`);
}

void main();
