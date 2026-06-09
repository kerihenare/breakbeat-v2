# Integration tests reuse the dev compose Postgres, not Testcontainers

Single-adapter integration tests (one Drizzle repository against a real database) run on **Vitest** and connect to the **`docker-compose.yml` Postgres** the project already ships for local dev — a dedicated test database/schema on the same `postgres:17-alpine` container. We **do not** use Testcontainers. This follows from how the test tiers are drawn: the Vitest/Playwright line is **surface under test, not presence of I/O** — Vitest owns pure logic *and* single-component integration (one adapter, one real dependency); Playwright owns only the end-to-end spine (both `breakbeat-web` + `breakbeat-worker` processes, the browser, SSE, a11y).

## Why

Testcontainers is the conventional answer for "real Postgres in a test," so its absence is surprising enough to record. The compose stack is already the one source of real backing services — it's how a developer runs the app, and the `analysis` skill assumes that same stack is up. Reusing it means one container lifecycle to understand and one connection story; Testcontainers would mint a *parallel* mechanism (its own images, ports, startup/teardown) for a solo/small-team greenfield with a single Postgres, buying isolation we don't yet need.

This also keeps the per-change loop honest. Because Vitest now crosses a real boundary for integration, the tiers are split by a filename suffix so the fast gate stays hermetic:

- `*.test.ts` — unit, port-faked / pure logic, **no I/O**. The `pnpm verify` set (Biome → tsc → FTA → `test:unit`), runnable on a clean checkout.
- `*.integration.test.ts` — single-adapter vs the compose Postgres; needs `docker compose up`. Scoped: run when the slice touches a real adapter.
- `*.e2e.ts` — Playwright, the two-process spine.

The same suffix vocabulary drives the FTA excludes (`*.integration.test.ts` is already caught by `**/*.test.ts`), so the test tiers and the complexity gate can't drift.

## Consequences

- Integration tests assume the compose stack is running; they are **not** part of `pnpm verify` and don't run on a bare checkout. CI (when it exists) must `docker compose up` before the integration/e2e tiers.
- Tests share a Postgres instance rather than getting a fresh container each — they must isolate via a dedicated test database/schema and clean up their own data (transactional rollback or per-test truncation), not by assuming a pristine container.
- Revisiting is a real cost: adopting Testcontainers later means rewriting every integration test's setup/teardown. The trade is accepted deliberately for now; if parallel-isolation pain shows up, this is the decision to revisit.
