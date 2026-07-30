package main

import (
	"os"

	"palscheduler/internal/config"
	"palscheduler/internal/dockerctl"
	"palscheduler/internal/scheduler"
)

// provideConfig 由 CONFIG_PATH 環境變數（預設 config.json）載入設定。
func provideConfig() (*config.Config, error) {
	path := os.Getenv("CONFIG_PATH")
	if path == "" {
		path = "config.json"
	}
	return config.Load(path)
}

// provideDocker 建立 Docker 控制器並以 scheduler.ServerController 介面提供。
func provideDocker(cfg *config.Config) scheduler.ServerController {
	return dockerctl.New(cfg.Docker.Socket, cfg.Docker.ContainerName, cfg.Docker.StopTimeoutSeconds)
}
