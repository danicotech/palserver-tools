# ---- build stage：用 node + pnpm 建置 Vite SPA ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# 先只複製依賴清單，善用 layer 快取
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --no-frozen-lockfile

# 複製原始碼並建置（root 的 build = build:shared 後再 build web → packages/web/dist）
COPY . .
RUN pnpm build

# ---- serve stage：nginx 提供靜態檔 ----
FROM nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
