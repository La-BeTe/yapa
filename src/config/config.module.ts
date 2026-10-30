import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

/**
 * The environment is validated when the provider is instantiated (not when this file is
 * imported), so a misconfigured process fails fast at boot and tests can prepare
 * process.env before creating the application.
 */
@Global()
@Module({
  providers: [
    {
      provide: AppConfigService,
      useFactory: () => new AppConfigService(validateEnv(process.env)),
    },
  ],
  exports: [AppConfigService],
})
export class AppConfigModule {}
