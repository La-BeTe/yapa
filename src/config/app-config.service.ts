import { Injectable } from '@nestjs/common';
import type { Env } from './env.schema';

/** Typed accessor over the validated environment. */
@Injectable()
export class AppConfigService {
  constructor(private readonly env: Env) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }
}
