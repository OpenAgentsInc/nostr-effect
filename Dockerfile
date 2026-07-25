FROM node:24-slim AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY vite.config.ts tsconfig.json tsconfig.check.json ./
RUN pnpm exec vp pack src/relay/main.ts --out-dir dist-relay --format esm --platform node --target node24

FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist-relay ./dist-relay
CMD ["node", "dist-relay/main.mjs"]
