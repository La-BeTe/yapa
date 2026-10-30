import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfigService } from '../config/app-config.service';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.get('MONGO_URI'),
        // Indexes are part of the data model; build them on boot so a fresh
        // `docker compose up` needs no migration step.
        autoIndex: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
