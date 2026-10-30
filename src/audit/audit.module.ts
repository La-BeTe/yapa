import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './audit-log.schema';
import { AuditLogWorker } from './audit-log.worker';
import { AuditPublisher } from './audit.publisher';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  providers: [AuditLogWorker, AuditPublisher],
  exports: [AuditPublisher],
})
export class AuditModule {}
