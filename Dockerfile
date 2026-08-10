# DataHubX governance console — one image, judges run it with:
#   docker compose --profile full up --build
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

COPY . .
# Build needs a DATABASE_URL shape, not a live database.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" bun run build

EXPOSE 3000
# Apply migrations against the compose database, then serve.
CMD ["sh", "-c", "bunx prisma migrate deploy && bun run start"]
