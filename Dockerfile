FROM node:22-bookworm-slim

WORKDIR /app

# 의존성 먼저 (캐시)
COPY web/package.json web/package-lock.json ./web/
COPY server/package.json server/package-lock.json ./server/
RUN cd web && npm ci
RUN cd server && npm ci

# 소스
COPY web ./web
COPY server ./server

# 프론트 빌드 → 서버 public
WORKDIR /app/web
RUN npm run build

WORKDIR /app/server
RUN npx prisma generate \
  && npx tsc \
  && rm -rf public \
  && mkdir -p public \
  && cp -r ../web/dist/. public/

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_URL=file:./data.db
ENV CLIENT_ORIGIN=*

EXPOSE 4000

CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
