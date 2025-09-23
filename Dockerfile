FROM node:22-alpine AS deps

WORKDIR /build

COPY package*.json ./
COPY yarn.lock ./

RUN yarn install --frozen-lockfile

FROM node:22-alpine AS build

WORKDIR /build

COPY --from=deps /build/node_modules ./node_modules
COPY . .

RUN yarn build

FROM node:22-alpine

WORKDIR /opt/5stack

RUN apk add --no-cache util-linux bash

COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist

CMD [ "node", "dist/cjs/index.js" ]
