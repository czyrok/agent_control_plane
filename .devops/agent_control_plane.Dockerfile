FROM oven/bun:1.4.4 AS production_dependencies

WORKDIR /project

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:26.13.1-alpine AS runner

WORKDIR /app

COPY --from=production_dependencies /project/node_modules ./node_modules
COPY package.json ./
COPY src ./src

ENV MCP_PORT=4331
ENV INTERNAL_PORT=4332
ENV NODE_ENV=production

EXPOSE 4331 4332
USER node
CMD ["node", "src/main.ts"]
