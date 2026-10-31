import {
  Body,
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsEmail } from 'class-validator';
import request from 'supertest';
import { isUlid, newId } from '../ids/ulid';
import { AppError, ErrorCode } from './app-error';
import { configureApp } from './configure-app';
import { failure } from './envelope';
import { REQUEST_ID_HEADER, RequestIdMiddleware } from './request-id.middleware';
import { RawEnvelope, WithMeta } from './response-envelope.interceptor';
import { ResponseMessage } from './response-message.decorator';

class EchoDto {
  @IsEmail()
  email!: string;
}

@Controller('probe')
class ProbeController {
  @Get('ok')
  @ResponseMessage('Probe succeeded')
  ok() {
    return { value: 1 };
  }

  @Get('domain-error')
  domainError() {
    throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, 'Not enough cNGN', undefined, {
      available: '10',
    });
  }

  @Get('http-error')
  httpError() {
    throw new NotFoundException('Nothing here');
  }

  @Get('crash')
  crash() {
    throw new Error('boom: internal detail');
  }

  @Get('raw')
  raw() {
    return new RawEnvelope(failure(ErrorCode.INSUFFICIENT_FUNDS, 'replayed'));
  }

  @Get('paged')
  @ResponseMessage('Page retrieved')
  paged() {
    return new WithMeta([{ value: 1 }], { next_cursor: null, limit: 1 });
  }

  @Post('echo')
  echo(@Body() body: EchoDto) {
    return body;
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}

describe('HTTP conventions', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  });

  afterAll(() => app.close());

  it('wraps results in a success envelope with the route message', async () => {
    const res = await request(app.getHttpServer()).get('/v1/probe/ok').expect(200);
    expect(res.body).toEqual({ status: 'success', message: 'Probe succeeded', data: { value: 1 } });
  });

  it('adds meta next to data for results that carry it', async () => {
    const res = await request(app.getHttpServer()).get('/v1/probe/paged').expect(200);
    expect(res.body).toEqual({
      status: 'success',
      message: 'Page retrieved',
      data: [{ value: 1 }],
      meta: { next_cursor: null, limit: 1 },
    });
  });

  it('maps domain errors to the error envelope with their code and status', async () => {
    const res = await request(app.getHttpServer()).get('/v1/probe/domain-error').expect(422);
    expect(res.body).toEqual({
      status: 'error',
      message: 'Not enough cNGN',
      data: { code: 'INSUFFICIENT_FUNDS', details: { available: '10' } },
    });
  });

  it('maps framework http exceptions', async () => {
    const res = await request(app.getHttpServer()).get('/v1/probe/http-error').expect(404);
    expect(res.body).toMatchObject({ status: 'error', data: { code: 'NOT_FOUND' } });
  });

  it('hides internal error details', async () => {
    const res = await request(app.getHttpServer()).get('/v1/probe/crash').expect(500);
    expect(res.body).toEqual({
      status: 'error',
      message: 'An unexpected error occurred',
      data: { code: 'INTERNAL_ERROR' },
    });
  });

  it('returns validation failures as a 400 error envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/probe/echo')
      .send({ email: 'nope', extra: true })
      .expect(400);
    expect(res.body.status).toBe('error');
    expect(res.body.data.code).toBe('VALIDATION_ERROR');
    expect(res.body.data.details).toEqual(
      expect.arrayContaining([expect.stringContaining('email'), expect.stringContaining('extra')]),
    );
  });

  it('passes pre-built envelopes through untouched', async () => {
    const res = await request(app.getHttpServer()).get('/v1/probe/raw').expect(200);
    expect(res.body).toEqual({
      status: 'error',
      message: 'replayed',
      data: { code: 'INSUFFICIENT_FUNDS' },
    });
  });

  it('generates a request id or echoes a valid client one', async () => {
    const generated = await request(app.getHttpServer()).get('/v1/probe/ok');
    expect(isUlid(generated.headers[REQUEST_ID_HEADER])).toBe(true);

    const supplied = newId();
    const echoed = await request(app.getHttpServer())
      .get('/v1/probe/ok')
      .set(REQUEST_ID_HEADER, supplied);
    expect(echoed.headers[REQUEST_ID_HEADER]).toBe(supplied);

    const invalid = await request(app.getHttpServer())
      .get('/v1/probe/ok')
      .set(REQUEST_ID_HEADER, 'abc');
    expect(invalid.headers[REQUEST_ID_HEADER]).not.toBe('abc');
  });
});
