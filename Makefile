.PHONY: up up-local down dev build migrate seed logs shell-backend shell-db \
        test lint models models-force

# ── Production (generic) ─────────────────────────────────────────────────────
up:
	docker compose up -d

# ── Production (local server with GPU + host model paths) ────────────────────
up-local:
	docker compose -f docker-compose.yml -f docker-compose.local.yml up -d

down:
	docker compose down

# ── Development (hot-reload) ─────────────────────────────────────────────────
dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

build:
	docker compose build

# ── Database ─────────────────────────────────────────────────────────────────
migrate:
	docker compose exec backend alembic upgrade head

seed:
	docker compose exec backend python -m app.scripts.seed_db

# ── Model management ─────────────────────────────────────────────────────────
# Run model-init manually (useful after FORCE_MODEL_DOWNLOAD=1 or first install)
models:
	docker compose run --rm model-init

models-force:
	FORCE_MODEL_DOWNLOAD=1 docker compose run --rm model-init

# ── Observability ────────────────────────────────────────────────────────────
logs:
	docker compose logs -f --tail=100

logs-backend:
	docker compose logs -f backend --tail=200

logs-models:
	docker compose logs model-init

# ── Shells ───────────────────────────────────────────────────────────────────
shell-backend:
	docker compose exec backend bash

shell-db:
	docker compose exec postgres psql -U opencctv opencctv

# ── Quality ──────────────────────────────────────────────────────────────────
test:
	docker compose exec backend pytest tests/ -v

lint:
	docker compose exec backend ruff check app/
