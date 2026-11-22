# Build context = repository root:  docker build -f apps/api/Dockerfile .
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages packages
RUN npm install
COPY apps/api apps/api
RUN npm --prefix apps/api run build

FROM node:20-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /repo
COPY --from=build /repo /repo
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /repo/apps/api
CMD ["node", "dist/main.js"]
