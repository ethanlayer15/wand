# ── Build stage ──────────────────────────────────────────────────────────
FROM node:20-slim AS build

RUN npm install -g pnpm@10.4.1

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# ── Production stage ────────────────────────────────────────────────────
FROM node:20-slim AS production

RUN npm install -g pnpm@10.4.1

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=build /app/dist ./dist

# Drizzle needs the migration files at runtime
COPY drizzle/ ./drizzle/

EXPOSE 5000
ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "dist/index.js"]
