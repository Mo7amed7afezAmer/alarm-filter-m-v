# Convenience wrappers; the same commands exist as `pnpm <target>` for hosts without make.
DEV = docker compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: up down logs dev test build ps

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

ps:
	docker compose ps

dev:
	$(DEV) up

test:
	pnpm test

build:
	docker compose build
