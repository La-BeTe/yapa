import type Redis from 'ioredis';
import { REDIS } from '../../src/redis/redis.constants';
import { StubRateProvider } from '../support/in-memory-fx';
import { createE2eApp, eventually, type E2eApp } from './e2e-app';

describe('FX rates (e2e)', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    // Start with the provider down so no rates are fetched on boot.
    const provider = new StubRateProvider();
    provider.failing = true;
    ctx = await createE2eApp('fx', {}, provider);
  });

  afterAll(() => ctx.close());

  const findPair = (rates: Array<Record<string, unknown>>, base: string, quote: string) =>
    rates.find((r) => r.base_currency === base && r.quote_currency === quote)!;

  it('returns 503 while no rates have ever been fetched and the provider is down', async () => {
    const res = await ctx.http.get('/v1/fx-rates').expect(503);
    expect(res.body).toMatchObject({ status: 'error', data: { code: 'FX_RATE_UNAVAILABLE' } });
    ctx.provider.failing = false;
  });

  it('returns all 20 pairs from the live provider and stores them as fallbacks', async () => {
    const res = await ctx.http.get('/v1/fx-rates').expect(200);
    expect(res.body.data).toHaveLength(20);
    expect(findPair(res.body.data, 'USDx', 'cNGN')).toEqual({
      base_currency: 'USDx',
      quote_currency: 'cNGN',
      mid_rate: '1500',
      spread_bps: 50,
      effective_rate: '1492.5',
      source: 'live',
      refreshed_at: ctx.provider.refreshedAt,
    });
    expect(await ctx.mongo.collection('fx_rates').countDocuments()).toBe(20);
  });

  it('falls back to stored rates when the provider fails', async () => {
    // Expire the cached live snapshot so the next quote has to hit the provider.
    await ctx.app.get<Redis>(REDIS).del('fx:live');
    ctx.provider.failing = true;

    const res = await ctx.http.get('/v1/fx-rates').expect(200);
    expect(findPair(res.body.data, 'USDx', 'cNGN')).toMatchObject({
      mid_rate: '1500',
      source: 'fallback',
    });

    ctx.provider.failing = false;
  });

  it('lets admins pin a static rate and spread per pair', async () => {
    await ctx.http.patch('/v1/admin/fx-rates/USDx/EURx').send({ prefer_static: true }).expect(401);

    const updated = await ctx.http
      .patch('/v1/admin/fx-rates/USDx/EURx')
      .set('x-admin-key', ctx.adminKey)
      .send({ rate: '0.95', spread_bps: 25, prefer_static: true })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      rate: '0.95',
      spread_bps: 25,
      prefer_static: true,
      source: 'admin',
    });

    const res = await ctx.http.get('/v1/fx-rates').expect(200);
    expect(findPair(res.body.data, 'USDx', 'EURx')).toMatchObject({
      mid_rate: '0.95',
      spread_bps: 25,
      source: 'static',
    });

    await ctx.http
      .patch('/v1/admin/fx-rates/USDx/USDx')
      .set('x-admin-key', ctx.adminKey)
      .send({ spread_bps: 1 })
      .expect(400);
    await ctx.http
      .patch('/v1/admin/fx-rates/USDx/EURx')
      .set('x-admin-key', ctx.adminKey)
      .send({ spread_bps: 10_000 })
      .expect(400);
  });

  it('refreshes rates on demand through the admin job trigger', async () => {
    ctx.provider.refreshedAt = '2026-10-31T09:00:00.000Z';
    await ctx.http
      .post('/v1/admin/jobs/fx-refresh/trigger')
      .set('x-admin-key', ctx.adminKey)
      .send({})
      .expect(202);

    await eventually(async () => {
      const res = await ctx.http.get('/v1/fx-rates').expect(200);
      expect(findPair(res.body.data, 'cNGN', 'cGHS').refreshed_at).toBe('2026-10-31T09:00:00.000Z');
    });
  });
});
