import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './common/http/configure-app';
import { setupOpenApi } from './common/http/openapi';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule));
  setupOpenApi(app);
  app.enableShutdownHooks();
  await app.listen(app.get(AppConfigService).get('PORT'));
}

void bootstrap();
