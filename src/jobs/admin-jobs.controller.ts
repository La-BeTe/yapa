import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsObject, IsOptional } from 'class-validator';
import { AdminKeyGuard } from '../common/auth/admin-key.guard';
import { ResponseMessage } from '../common/http/response-message.decorator';
import { JobsRegistry } from './jobs.registry';

export class TriggerJobDto {
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

@Controller('admin/jobs')
@UseGuards(AdminKeyGuard)
export class AdminJobsController {
  constructor(private readonly registry: JobsRegistry) {}

  @Get()
  @ResponseMessage('Registered jobs retrieved')
  list() {
    return this.registry.list();
  }

  @Post(':name/trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Job enqueued')
  async trigger(@Param('name') name: string, @Body() body: TriggerJobDto) {
    const jobId = await this.registry.enqueue(name, body.payload ?? {});
    return { name, job_id: jobId };
  }
}
