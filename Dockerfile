# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN yarn build

FROM base AS prod-deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn workspaces focus --all --production

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
