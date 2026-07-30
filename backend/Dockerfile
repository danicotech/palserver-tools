# ---- build stage ----
FROM golang:1.26-alpine AS build
WORKDIR /src

# 先複製 go.mod/go.sum 以善用快取
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/palscheduler ./cmd/scheduler

# ---- runtime stage ----
FROM alpine:3.20
RUN apk add --no-cache tzdata ca-certificates
WORKDIR /app
COPY --from=build /out/palscheduler /app/palscheduler
# config.json 由 compose 以 volume 掛入 /app/config.json（見 docker-compose.yml）
ENV CONFIG_PATH=/app/config.json
EXPOSE 9000
ENTRYPOINT ["/app/palscheduler", "serve"]
