FROM node:20-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN apk add --no-cache su-exec \
  && corepack enable


FROM base AS build-deps

RUN apk add --no-cache python3 make g++

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else npm install; fi


FROM build-deps AS build

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY test ./test

RUN if [ -f pnpm-lock.yaml ]; then pnpm run build; else npm run build; fi


FROM build-deps AS production-deps

RUN if [ -f pnpm-lock.yaml ]; then pnpm prune --prod; else npm prune --omit=dev; fi


FROM build-deps AS development

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY test ./test
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER root

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["pnpm", "run", "start:dev"]


FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache su-exec

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /data/noderax /app/node_modules /pnpm \
  && chown -R node:node /data/noderax /app /pnpm

USER root

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["node", "dist/main.js"]
