# YAPA

**YAPA**: _YAPA Is Another Payment API_. A multi-currency stablecoin wallet sandbox.

YAPA is a REST API for virtual wallets holding five mock stablecoins (**cNGN, cGHS, cXAF, USDx, EURx**). Clients can create wallets, make simulated deposits, swap currencies inside a wallet, and send money to other wallets with automatic FX conversion. They can also read balances, transaction history and live conversion rates.

The name is a recursive acronym in the tradition of GNU and YACC: an honest description of what it is.

---

## Contents

- [Tech stack](#tech-stack)
- [Why this database setup](#why-this-database-setup)
- [Running it](#running-it)
- [Running the tests](#running-the-tests)
- [API walkthrough](#api-walkthrough)
- [Data model](#data-model)
- [Money precision](#money-precision)
- [Idempotency](#idempotency)
- [Concurrency](#concurrency)
- [FX rates and provider failures](#fx-rates-and-provider-failures)
- [Background jobs, audit and request logs](#background-jobs-audit-and-request-logs)
- [Assumptions](#assumptions)
- [Known limitations and what I left out](#known-limitations-and-what-i-left-out)
- [What I would do with more time](#what-i-would-do-with-more-time)

---

## Tech stack

| Area           | Choice                                                                 | Why                                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime        | Node.js 24 LTS, TypeScript (strict, `noUncheckedIndexedAccess`)        | Required by the brief. Strict mode plus `bigint` keeps money code honest.                                                                                                                                           |
| Framework      | NestJS 11                                                              | Modules and DI keep the ledger, FX, wallets and jobs separate and easy to test. Interceptors and filters give one response envelope everywhere. NestJS 12 is ESM-only, so 11 (CommonJS) keeps Jest straightforward. |
| Ledger         | **TigerBeetle**                                                        | A purpose-built double-entry accounting database. It is the source of truth for balances (see below).                                                                                                               |
| Metadata store | **MongoDB** (Mongoose)                                                 | Wallets, accounts registry, the transaction read model, FX configuration, audit and request logs.                                                                                                                   |
| Cache / queue  | **Redis** + **BullMQ**                                                 | Live FX rate cache, transaction-history cache, and background workers (FX refresh, reconciler, audit and request logs).                                                                                             |
| Validation     | class-validator, zod (environment)                                     |                                                                                                                                                                                                                     |
| Money maths    | `bigint` + decimal.js                                                  | Integer minor units end to end; decimal.js is used only for rates.                                                                                                                                                  |
| IDs            | ULID                                                                   | Time-ordered, used for every Mongo `_id` **and** as TigerBeetle u128 ids, so an id means the same thing in both stores.                                                                                             |
| Tests          | Jest, Supertest, Testcontainers                                        | Unit tests on in-memory fakes, plus e2e tests against real MongoDB, Redis and TigerBeetle containers.                                                                                                               |
| Tooling        | Yarn 4 (Corepack), ESLint, Prettier, commitlint, husky, GitHub Actions | Conventional commits are enforced by a commit-msg hook and checked in CI.                                                                                                                                           |
| API docs       | OpenAPI 3 (`@nestjs/swagger`)                                          | Served at `/docs`, with the raw spec at `/docs/docs.json`.                                                                                                                                                          |

## Why this database setup

**TigerBeetle holds the money; MongoDB holds everything about the money.**

Balances and money movement live in TigerBeetle, a database built for exactly this:

- **Double-entry by construction.** Every transfer debits one account and credits another on the same ledger (one ledger per currency), so money can't appear or vanish.
- **No negative balances, enforced by the database.** User accounts carry the `debits_must_not_exceed_credits` flag. An overdraft is rejected atomically inside the ledger, not by a read-then-write check in application code.
- **Atomic multi-leg operations.** A swap or cross-currency transfer is 2–3 transfers submitted as one _linked chain_: all of them apply or none do.
- **Idempotent by id.** Resubmitting a transfer id returns `exists` instead of applying it twice, which is the foundation of the idempotency and recovery design.
- **Serial execution.** TigerBeetle applies transfers one at a time, so concurrency needs no row locks or retries in the API.

MongoDB (the brief's required database) stores the metadata TigerBeetle intentionally doesn't: wallet identity, which ledger accounts belong to which wallet, the business-level transaction record (rate applied, fee, source and destination, status, cached response), FX configuration, audit trail and request logs. Its flexible documents fit these records well, and its unique indexes give us wallet-identity uniqueness and `unique_reference` idempotency.

The two stores can't share a transaction, so the write path is ordered to make every crash recoverable (see [Idempotency](#idempotency)).

Why not just PostgreSQL? A single Postgres with `SELECT … FOR UPDATE` and `CHECK (balance >= 0)` would also be correct. TigerBeetle makes the hard guarantees (no overdraft, atomic multi-leg, idempotent ids, double-entry) properties of the ledger rather than of code I wrote. For a payments sandbox, that seemed the more interesting and more defensible design.

## Running it

Requirements: Docker with Compose. For local development without Docker you also need Node 24 and Corepack.

```bash
docker compose up --build
```

This starts the API (`http://localhost:3000`), MongoDB, Redis and TigerBeetle. There are no manual migration steps. On boot:

- TigerBeetle formats its data file on first start (handled by [`docker/tigerbeetle/entrypoint.sh`](docker/tigerbeetle/entrypoint.sh));
- Mongo indexes are built;
- the per-currency operator accounts (treasury, FX pool, fee) are created idempotently in Mongo and TigerBeetle;
- the `fx-refresh` worker fetches live rates immediately and then on a schedule.

Useful URLs:

- Swagger UI: http://localhost:3000/docs (raw spec at `/docs/docs.json`)
- Health: http://localhost:3000/v1/health (send `X-Admin-Key` to see the MongoDB, Redis and TigerBeetle checks)

> TigerBeetle uses io_uring and locks memory, so its container runs with `seccomp=unconfined`, `IPC_LOCK` and an unlimited memlock ulimit (see `docker-compose.yml`). On Docker Desktop, give the VM at least 4 GB of memory.

**Local development** (dependencies in Docker, API on the host):

```bash
corepack enable
yarn install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mongo redis tigerbeetle
cp .env.example .env
set -a && source .env && set +a
yarn start:dev
```

`docker-compose.dev.yml` publishes MongoDB, Redis and TigerBeetle on 27017, 6379 and 3001 (override with `MONGO_PORT`, `REDIS_PORT`, `TB_PORT`). The default `docker compose up` publishes only the API, so it does not clash with databases already running on the host.

Configuration is environment-driven and validated at boot ([`src/config/env.schema.ts`](src/config/env.schema.ts), example in [`.env.example`](.env.example)).

## Running the tests

```bash
yarn test          # everything: unit + e2e (needs a running Docker daemon)
yarn test:unit     # fast, no Docker: services wired to in-memory TigerBeetle/FX/repository fakes
yarn test:e2e      # Testcontainers: real MongoDB, Redis and TigerBeetle
yarn lint && yarn typecheck
```

- **Unit tests** cover money parsing and conversion (including 0-decimal cXAF), rate rounding, FX resolution (live, cached, static, fallback, 503), the ledger wrapper, the transaction service end to end, history pagination and caching, the reconciler, the worker framework, the HTTP envelope and validation, and log sanitising. The transaction tests run on an in-memory TigerBeetle fake that enforces linked-chain atomicity, `exists`, `id_already_failed` and the no-overdraft flag. They include concurrent overdraft attempts, concurrent duplicate requests and crash-between-stores recovery.
- **E2E tests** boot the real `AppModule` against containers started once per run ([`test/e2e/global-setup.ts`](test/e2e/global-setup.ts)). Each suite gets its own Mongo database and Redis logical database, and the live FX provider is replaced by a controllable stub.

## API walkthrough

All routes are under `/v1`. Conventions:

- Every response is an envelope: `{ "status": "success" | "error", "message": string, "data": ... }`. Paginated responses add `meta` (`next_cursor`, `limit`) next to `data`. Errors carry `data: { code, details? }` with a stable machine-readable `code`.
- **Amounts are integer strings in minor units.** cNGN, cGHS, USDx and EURx have 2 decimals (`"150025"` = 1,500.25); cXAF has 0. Wallet balances include each currency's `scale`; transaction amounts use the same per-currency scale.
- Field names are snake_case. IDs are ULIDs.
- Every response carries an `X-Request-Id` header. Send your own (a ULID) to correlate.

The values below are illustrative; live rates move.

### Create a wallet

```http
POST /v1/wallets
{ "email": "ada@example.com", "phone": "+2348031234567" }
```

```json
201
{
  "status": "success",
  "message": "Wallet created",
  "data": {
    "id": "01JBWALLETALICE0000000000A",
    "email": "ada@example.com",
    "phone": "+2348031234567",
    "status": "ACTIVE",
    "created_at": "2026-10-30T12:00:00.000Z",
    "updated_at": "2026-10-30T12:00:00.000Z"
  }
}
```

At least one of `email` and `phone` is required. Emails are lower-cased; phones must be international and are stored as E.164. Reusing either returns `409 WALLET_ALREADY_EXISTS`.

### Deposit

All money movement goes through `POST /v1/transactions`, selected by `type`.

```http
POST /v1/transactions
{
  "type": "DEPOSIT",
  "unique_reference": "dep-0001",
  "destination_wallet_id": "01JBWALLETALICE0000000000A",
  "currency": "cNGN",
  "amount": "1500000"
}
```

```json
201
{
  "status": "success",
  "message": "Transaction completed",
  "data": {
    "id": "01JBTXN0000000000000000001",
    "type": "DEPOSIT",
    "status": "COMPLETED",
    "unique_reference": "dep-0001",
    "source": { "wallet_id": null, "amount": "1500000", "currency": "cNGN" },
    "destination": { "wallet_id": "01JBWALLETALICE0000000000A", "amount": "1500000", "currency": "cNGN" },
    "fx": null,
    "failure": null,
    "created_at": "2026-10-30T12:00:00.000Z",
    "completed_at": "2026-10-30T12:00:00.000Z"
  }
}
```

### Swap (same wallet, two currencies)

```http
POST /v1/transactions
{
  "type": "SWAP",
  "unique_reference": "swap-0001",
  "source_wallet_id": "01JBWALLETALICE0000000000A",
  "source_currency": "cNGN",
  "destination_currency": "USDx",
  "amount": "750000"
}
```

```json
201
{
  "status": "success",
  "message": "Transaction completed",
  "data": {
    "type": "SWAP",
    "source": { "wallet_id": "01JBWALLETALICE0000000000A", "amount": "750000", "currency": "cNGN" },
    "destination": { "wallet_id": "01JBWALLETALICE0000000000A", "amount": "498", "currency": "USDx" },
    "fx": {
      "mid_rate": "0.00066666666666666666667",
      "effective_rate": "0.00066333333333333333334",
      "spread_bps": 50,
      "fee_amount": "2",
      "rate_source": "live",
      "rate_refreshed_at": "2026-10-30T00:00:01.000Z"
    },
    "...": "..."
  }
}
```

At 1 USD = 1,500 NGN, 7,500.00 cNGN is exactly 5.00 USDx (500). The 50 bps spread is 2.5, floored to 2, so the wallet receives 4.98 USDx (498).

### Transfer (another wallet, same or different currency)

```http
POST /v1/transactions
{
  "type": "TRANSFER",
  "unique_reference": "trf-0001",
  "source_wallet_id": "01JBWALLETALICE0000000000A",
  "destination_wallet_id": "01JBWALLETBOB000000000000B",
  "source_currency": "USDx",
  "destination_currency": "cGHS",
  "amount": "400"
}
```

If `destination_currency` is omitted, it defaults to `source_currency` (no conversion). The record holds the sender, receiver, source amount and currency, destination amount and currency, the applied rate and fee, and timestamps.

**Failures** are returned in the error envelope and recorded:

```json
422
{
  "status": "error",
  "message": "Insufficient USDx balance",
  "data": { "code": "INSUFFICIENT_FUNDS", "details": { "transaction_id": "01JBTXN..." } }
}
```

Other codes: `VALIDATION_ERROR` (400), `WALLET_NOT_FOUND` (404), `TRANSACTION_IN_PROGRESS` (409), `UNIQUE_REFERENCE_REUSED`, `AMOUNT_TOO_SMALL`, `SAME_CURRENCY_SWAP`, `SAME_WALLET_TRANSFER` (422), and `FX_RATE_UNAVAILABLE` / `TRANSACTION_PENDING` (503).

### Balances

```http
GET /v1/wallets/01JBWALLETALICE0000000000A
```

```json
200
{
  "status": "success",
  "message": "Wallet retrieved",
  "data": {
    "id": "01JBWALLETALICE0000000000A",
    "status": "ACTIVE",
    "balances": [
      { "currency": "cNGN", "amount": "750000", "scale": 2 },
      { "currency": "cGHS", "amount": "0", "scale": 2 },
      { "currency": "cXAF", "amount": "0", "scale": 0 },
      { "currency": "USDx", "amount": "98", "scale": 2 },
      { "currency": "EURx", "amount": "0", "scale": 2 }
    ],
    "total_usd": { "currency": "USDx", "amount": "598", "scale": 2 },
    "...": "..."
  }
}
```

Balances are read live from TigerBeetle. `total_usd` values each balance at the **mid** rate (no spread), rounds down, and is `null` if no rate is available.

### History and single transactions

```http
GET /v1/transactions?wallet_id=01JB...&type=TRANSFER&currency=USDx&limit=20&cursor=01JB...
GET /v1/transactions/{id}
```

`wallet_id` is required. History includes deposits, swaps and transfers the wallet sent and received, newest first. Each item has a `direction` (`IN`, `OUT`, `SELF`). `currency` matches either side. Pagination is cursor-based: pass `meta.next_cursor` back as `cursor`.

```json
{
  "status": "success",
  "message": "Transactions retrieved",
  "data": [{ "...transaction...": "", "direction": "OUT" }],
  "meta": { "next_cursor": "01JB...", "limit": 20 }
}
```

### Rates

```http
GET /v1/fx-rates
```

Returns all 20 directed pairs:

```json
{
  "base_currency": "USDx",
  "quote_currency": "cNGN",
  "mid_rate": "1500",
  "spread_bps": 50,
  "effective_rate": "1492.5",
  "source": "live",
  "refreshed_at": "2026-10-30T00:00:01.000Z"
}
```

### Admin (header `X-Admin-Key`)

| Endpoint                                  | Purpose                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /v1/admin/fx-rates`                  | Stored (static / fallback) rate and configuration per pair                     |
| `PATCH /v1/admin/fx-rates/{base}/{quote}` | Set `rate`, `spread_bps` or `prefer_static` for a pair                         |
| `GET /v1/admin/jobs`                      | Registered background workers and schedules                                    |
| `POST /v1/admin/jobs/{name}/trigger`      | Run a worker now: `fx-refresh`, `reconciler`, … (optional `{ "payload": {} }`) |

## Data model

### TigerBeetle (balances and money movement)

- **Ledgers:** one per currency: cNGN=1, cGHS=2, cXAF=3, USDx=4, EURx=5. Transfers never cross ledgers.
- **Accounts** (`code`):
  - `100` USER: one per wallet per currency, with no overdraft allowed;
  - `200` TREASURY: one per currency, funds simulated deposits;
  - `300` FX_POOL: one per currency, the counterparty for every conversion;
  - `400` FEE: one per currency, collects the spread.
- **Transfers** (`code` 1 DEPOSIT, 2 SWAP, 3 TRANSFER, 4 FX_FEE). `user_data_128` holds the business transaction id.

| Operation                            | Legs (one linked chain)                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| Deposit                              | TREASURY[c] → USER[c]                                                                 |
| Transfer, same currency              | USER_src[c] → USER_dst[c]                                                             |
| Swap / cross-currency transfer A → B | USER_src[A] → POOL[A] (amount) · POOL[B] → USER_dst[B] (net) · POOL[B] → FEE[B] (fee) |

Each ledger always sums to zero. Pool balances show the platform's net FX position per currency.

### MongoDB (snake_case fields, ULID `_id`, `created_at`/`updated_at`)

| Collection     | Purpose and key fields                                                                                                                                                                                                                                                                                                                                                                | Indexes                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `wallets`      | `email?`, `phone?` (E.164), `status` (`PROVISIONING` → `ACTIVE`)                                                                                                                                                                                                                                                                                                                      | unique sparse `email`, unique sparse `phone`                                                                                     |
| `accounts`     | Registry of ledger accounts. `_id` **is** the TigerBeetle account id. `wallet_id` (null for operator accounts), `type`, `currency`, `ledger`                                                                                                                                                                                                                                          | unique `(wallet_id, currency)` for USER; unique `(type, currency)` for operator accounts                                         |
| `transactions` | `type`, `status` (`PENDING`/`COMPLETED`/`FAILED`), `unique_reference`, `request_hash`, `source {wallet_id, amount, currency}`, `destination {…}`, `fx {mid_rate, effective_rate, spread_bps, fee_amount, rate_source, rate_refreshed_at}`, `ledger_transfers[]` (the exact legs, with ids), `failure`, `response` (status and body replayed to retries), `request_id`, `completed_at` | unique `unique_reference`; `(source.wallet_id, _id)`, `(destination.wallet_id, _id)`; partial `(status, updated_at)` for PENDING |
| `fx_rates`     | Per directed pair: static/fallback `rate`, `spread_bps`, `prefer_static`, `source` (`provider`/`admin`)                                                                                                                                                                                                                                                                               | unique `(base_currency, quote_currency)`                                                                                         |
| `audit_logs`   | Wallet event trail: `wallet_id`, `event`, `transaction_id`, `request_id`, `metadata`, `occurred_at`                                                                                                                                                                                                                                                                                   | `(wallet_id, _id)`; unique `(wallet_id, event, transaction_id)`                                                                  |
| `request_logs` | `request_id`, method, path, query, redacted headers, body, response status and body, `duration_ms`                                                                                                                                                                                                                                                                                    | unique `request_id`; TTL on `occurred_at` (`REQUEST_LOG_TTL_DAYS`)                                                               |

`amount` on a transaction is always the **source** amount. Amounts are stored as integer strings, which stay exact beyond 2^53.

## Money precision

- **Integer minor units everywhere.** The API accepts and returns amounts as integer strings (`^[1-9]\d*$`, below 2^63). They are `bigint` in TypeScript and u128 in TigerBeetle. No floating point ever touches an amount.
- **Per-currency scale.** cXAF has 0 decimals (like the CFA franc); the others have 2. Conversions rescale between them.
- **Rates** are decimal strings, rounded **half-up to 20 significant digits**. The rounded rate is the one recorded and applied, so anyone can recompute a conversion from the stored transaction.
  - An early version truncated rates to 15 digits. That turned 1/1500 into 0.000666…6 and valued 1,500.00 NGN at 0.99 USD. A test caught it, and it's fixed in its own commit.
- **Conversion:** `gross = floor(amount × mid_rate × 10^(scale_dst − scale_src))`, `fee = floor(gross × spread_bps / 10000)`, `net = gross − fee`.
  - Every step rounds **down**, so a client never receives more than the exact value. Sub-unit residue stays in the FX pool.
  - If `net` would be 0, the request is rejected with `AMOUNT_TOO_SMALL` rather than taking money for nothing.
- **Balances can't go negative**, because TigerBeetle enforces it on every user account (`exceeds_credits` → `422 INSUFFICIENT_FUNDS`).

## Idempotency

`unique_reference` (required, globally unique) is the idempotency key for `POST /v1/transactions`.

1. The request is validated and normalised, then fingerprinted (`request_hash`).
2. If the reference already exists:
   - with a different fingerprint → `422 UNIQUE_REFERENCE_REUSED`;
   - `COMPLETED` / `FAILED` → the **stored status code and body are replayed** verbatim;
   - `PENDING` and recent → `409 TRANSACTION_IN_PROGRESS`;
   - `PENDING` and stale (the original request died) → it is **resumed** (step 4).
3. Otherwise the FX quote, amounts and ledger legs, **including pre-generated TigerBeetle transfer ids**, are computed and stored as a `PENDING` transaction. The unique index on `unique_reference` settles concurrent duplicates: only one insert wins, and the others become replays.
4. The stored legs are submitted to TigerBeetle as one linked chain, then the transaction is finalized with its response.

Because the ledger ids are fixed before submission, any re-execution (client retry or reconciler) resubmits the same ids. TigerBeetle answers `exists` for legs it already applied, so **money can't move twice**, even after a crash between the ledger write and the Mongo update. Failed transactions are final: TigerBeetle rejects reused failed ids (`id_already_failed`), and the client should retry with a new reference.

**If TigerBeetle is unreachable**, every ledger request is bounded by `TB_REQUEST_TIMEOUT_MS` (the client would otherwise retry forever), so the transaction stays `PENDING` and the API answers `TRANSACTION_PENDING` (503). The client only accepts IPs, so `TB_ADDRESS` is resolved at boot; after any ledger failure the hostname is resolved again and, if the replica moved (e.g. its container was recreated), the API reconnects without a restart.

Validation errors, unknown wallets and FX unavailability are rejected **before** anything is stored, so the same reference can be reused after fixing the request.

## Concurrency

- **Balances:** TigerBeetle executes transfers serially and enforces no-overdraft atomically. N concurrent transfers draining one balance can't overdraw it, with no locks or retry loops in the API. This is tested with 20–25 parallel transfers and swaps against one balance.
- **Duplicates:** the unique index on `unique_reference` plus conditional finalization (`status: PENDING` → final, at most once) means concurrent identical requests produce one movement.
- **Wallet creation:** unique sparse indexes on email and phone; racing creations get exactly one `201`.
- **Multi-instance safety:** all state is in MongoDB, Redis and TigerBeetle. Repeatable jobs are scheduled through BullMQ job schedulers, so they run once per interval across instances.

## FX rates and provider failures

Live rates come from [open.er-api.com](https://open.er-api.com) (keyless, USD-based, covers NGN/GHS/XAF/EUR) with a 3-second timeout. Each stablecoin is pegged 1:1 to the fiat currency it tracks, and cross rates are derived from the USD base.

Resolution for a pair (`FxRateService.quote`):

1. The pair must exist in `fx_rates`. If it doesn't, rates are fetched from the provider and **all missing pairs are inserted** (default spread `FX_DEFAULT_SPREAD_BPS`).
2. If the pair is `prefer_static` → its stored rate (`source: "static"`).
3. Otherwise the live snapshot from Redis (`source: "live"`). When the cache is cold, one fetch is shared by all concurrent callers.
4. If the provider fails → the pair's stored rate as **fallback** (`source: "fallback"`, `refreshed_at` = when it was stored).
5. If the pair has never been stored and the provider is down → `503 FX_RATE_UNAVAILABLE`, with no money moved.

The `fx-refresh` worker refreshes the Redis snapshot and the stored rates on boot and every `FX_REFRESH_EVERY_MS`, so the fallback is always the last known-good rate. Admin-pinned (`prefer_static`) rows are never overwritten. Spreads are configured **per directed pair**. Every transaction records the mid rate, effective rate, spread, fee, rate source and refresh time it used.

## Background jobs, audit and request logs

Workers extend `BaseWorker` and are marked with `@JobWorker('name')`. The `JobsRegistry` discovers them at boot, creates their BullMQ queue and worker, and registers any schedule. Adding a worker is one class plus one line in a module's providers. Any worker can be triggered on demand with `POST /v1/admin/jobs/{name}/trigger`.

| Worker        | Trigger                                   | Does                                                                                                         |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `fx-refresh`  | every `FX_REFRESH_EVERY_MS` (and on boot) | Fetch live rates into Redis and `fx_rates`                                                                   |
| `reconciler`  | every `RECONCILER_EVERY_MS`               | Re-execute stale `PENDING` transactions with their stored legs; finish wallets stuck in `PROVISIONING`       |
| `audit-log`   | event                                     | Persist wallet events (created, deposit, swap, sent, received, failed, reconciled) to `audit_logs`           |
| `request-log` | every request                             | Persist request and response (headers redacted, bodies over 16 KB truncated) to `request_logs` by request id |

Audit and request logging are fire-and-forget: a Redis hiccup never fails a payment. Deterministic job ids and unique indexes make worker retries idempotent.

## Assumptions

- Stablecoins are pegged 1:1 to their fiat currency, so FX between them is the fiat cross rate.
- Deposits are simulated: money is minted from a per-currency treasury account (which goes negative, representing the platform's issued supply).
- FX liquidity is unlimited: pool accounts are unbounded, so a swap never fails for lack of liquidity.
- There is no authentication beyond wallet-identity uniqueness, as allowed by the brief. Admin routes use a static shared key.
- A failed transaction is final for its `unique_reference`.
- Phone numbers must be in international format; there is no default country.

## Known limitations and what I left out

- **No user authentication or authorisation.** Anyone who knows a wallet id can read it and move its funds. That's acceptable for a sandbox and is the first thing to add.
- **Mongo and TigerBeetle are eventually consistent** for the transaction record. The ledger is always correct, but a crash can leave a transaction `PENDING` for up to `RECONCILER_STALE_AFTER_MS` + one reconciler interval before it shows `COMPLETED`.
- **Single-replica TigerBeetle** in Compose. Production would run a 3- or 6-replica cluster.
- **No rate locking or quotes.** The rate is taken at request time. Real FX flows usually issue a quote with an expiry that the client accepts.
- **Live provider rates update daily** on the free tier, so "live" is coarse. The source and refresh time are always exposed.
- **History cache** is per wallet and per query with a short TTL, invalidated by a version bump. A page fetched while a transaction is still `PENDING` refreshes when that transaction finalizes.
- **No withdrawals, reversals, limits, KYC or multi-tenant separation.** Left out to keep the scope focused on correct money movement, as the brief recommends.

## What I would do with more time

- Authentication (API keys or OAuth) with wallet ownership checks, and per-key rate limiting.
- FX quotes: `POST /quotes` returns a rate locked for N seconds, and transactions reference the quote.
- Withdrawals and reversals, using TigerBeetle pending/two-phase transfers.
- Velocity limits and AML-style checks before submission.
- Reconcile ledger balances against the Mongo read model on a schedule, with alerting on drift.
- OpenTelemetry tracing across HTTP → Mongo → TigerBeetle → BullMQ, plus Prometheus metrics.
- A multi-replica TigerBeetle cluster in Compose, and load tests on the transfer path.
- Webhooks for transaction status changes.
