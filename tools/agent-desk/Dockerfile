FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends gh git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY bin ./bin
ARG SOURCE_SHA=unavailable
RUN node -e 'require("fs").writeFileSync("build-info.json",JSON.stringify({sha:process.argv[1]}))' "$SOURCE_SHA"
ENV AGENT_DESK_HOST=0.0.0.0 AGENT_DESK_PORT=4310 AGENT_DESK_DATA_DIR=/data
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4310/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/http.mjs"]
