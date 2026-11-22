# Build context = repository root:  docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_BASE=https://api.example .
FROM node:20-slim AS build
ARG NEXT_PUBLIC_API_BASE=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
WORKDIR /repo
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages packages
RUN npm install
COPY apps/web apps/web
RUN npm --prefix apps/web run build

FROM node:20-slim
ENV NODE_ENV=production PORT=3001
WORKDIR /repo
COPY --from=build /repo /repo
USER node
EXPOSE 3001
WORKDIR /repo/apps/web
CMD ["npx", "next", "start", "-p", "3001"]
