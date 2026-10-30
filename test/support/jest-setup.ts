import { Logger } from '@nestjs/common';

// Keep test output readable; set DEBUG_LOGS=1 to see Nest logs.
if (!process.env.DEBUG_LOGS) {
  Logger.overrideLogger(false);
}
