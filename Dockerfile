# Node 18 matches @types/node in package.json and runs Nest 9 / TS 4.x reliably.
FROM node:18.20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare yarn@1.22.19 --activate

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-engines

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY templates ./templates

RUN yarn build

FROM node:18.20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable && corepack prepare yarn@1.22.19 --activate

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --ignore-engines && yarn cache clean

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/templates ./templates

USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
