import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfigService } from '../config/app-config.service';
import { RequestLogMiddleware } from './request-log.middleware';
import { RequestLog, RequestLogSchema } from './request-log.schema';
import { RequestLogWorker } from './request-log.worker';

const SECONDS_PER_DAY = 24 * 60 * 60;

@Module({
  imports: [
    MongooseModule.forFeatureAsync([
      {
        name: RequestLog.name,
        inject: [AppConfigService],
        useFactory: (config: AppConfigService) => {
          const schema = RequestLogSchema.clone();
          schema.index(
            { occurred_at: 1 },
            { expireAfterSeconds: config.get('REQUEST_LOG_TTL_DAYS') * SECONDS_PER_DAY },
          );
          return schema;
        },
      },
    ]),
  ],
  providers: [RequestLogWorker, RequestLogMiddleware],
  exports: [RequestLogMiddleware],
})
export class RequestLogsModule {}
