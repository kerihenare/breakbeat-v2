#!/usr/bin/env bash
#
# Boot the full local dev stack in one command.
#
#   1. Ensure .env exists (seed from .env.example on first run)
#   2. Ensure dependencies are installed
#   3. Start backing services (postgres, redis, otel-lgtm, bugsink) and wait
#      until they are healthy
#   4. Apply the database schema (drizzle-kit push)
#   5. Run the app in watch mode (web + worker + css) in the foreground
#
# Ctrl+C stops the watch processes but leaves the containers running.
# Run `pnpm down` to stop the containers.

set -euo pipefail

# Always operate from the repo root, regardless of where the script is called.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }

# 1. .env --------------------------------------------------------------------
if [ ! -f .env ]; then
  step "No .env found — seeding from .env.example"
  cp .env.example .env
  echo "  Created .env. Add API keys later if you want the external stages live."
fi

# 2. Dependencies ------------------------------------------------------------
if [ ! -d node_modules ]; then
  step "Installing dependencies (pnpm install)"
  pnpm install
fi

# 3. Backing services --------------------------------------------------------
step "Starting backing services (docker compose up -d --wait)"
docker compose up -d --wait

# Load .env into the environment so the nest watch processes inherit
# DATABASE_URL / REDIS_URL etc. (they read process.env directly — no dotenv).
step "Loading .env"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# 4. Database schema ---------------------------------------------------------
step "Applying database schema (pnpm migrate:push)"
pnpm migrate:push

# 5. App (foreground) --------------------------------------------------------
step "Starting app — web (http://localhost:${PORT:-3000}), worker, css"
echo "  Grafana  http://localhost:3030"
echo "  Bugsink  http://localhost:8000"
echo
exec pnpm dev
