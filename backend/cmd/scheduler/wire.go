//go:build wireinject
// +build wireinject

package main

// 這個檔案是 Google Wire 的注入器範本，僅在執行 `wire` 產碼時使用。
// 一般建置會忽略（見 build tag），改用 wire_gen.go。
// 產碼指令： go run github.com/google/wire/cmd/wire@latest ./cmd/scheduler

import (
	"github.com/google/wire"

	"palscheduler/internal/api"
	"palscheduler/internal/app"
	"palscheduler/internal/scheduler"
)

func InitializeApp() (*app.App, error) {
	wire.Build(
		provideConfig,
		provideDocker,
		scheduler.New,
		api.New,
		app.New,
	)
	return nil, nil
}
