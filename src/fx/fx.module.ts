import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FxRate, FxRateSchema } from './fx-rate.schema';
import { FxRateService } from './fx-rate.service';
import { AdminFxRatesController, FxRatesController } from './fx-rates.controller';
import { FxRefreshWorker } from './fx-refresh.worker';
import { FX_RATE_STORE, LIVE_RATE_CACHE, LIVE_RATE_PROVIDER } from './fx.types';
import { MongoFxRateStore } from './mongo-fx-rate.store';
import { OpenErApiProvider } from './open-er-api.provider';
import { RedisLiveRateCache } from './redis-live-rate.cache';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: FxRate.name, schema: FxRateSchema }])],
  controllers: [FxRatesController, AdminFxRatesController],
  providers: [
    FxRateService,
    FxRefreshWorker,
    { provide: LIVE_RATE_PROVIDER, useClass: OpenErApiProvider },
    { provide: FX_RATE_STORE, useClass: MongoFxRateStore },
    { provide: LIVE_RATE_CACHE, useClass: RedisLiveRateCache },
  ],
  exports: [FxRateService],
})
export class FxModule {}
