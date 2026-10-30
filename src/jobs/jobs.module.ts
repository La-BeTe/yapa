import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AdminKeyGuard } from '../common/auth/admin-key.guard';
import { AdminJobsController } from './admin-jobs.controller';
import { BullFactory } from './bull-factory';
import { JobsRegistry } from './jobs.registry';

/**
 * Background job infrastructure. Feature modules declare their own @JobWorker providers;
 * the registry discovers them across the whole application.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [AdminJobsController],
  providers: [BullFactory, JobsRegistry, AdminKeyGuard],
  exports: [JobsRegistry, AdminKeyGuard],
})
export class JobsModule {}
