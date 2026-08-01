package main

import (
	"log"
	"os"
	"strings"

	"palscheduler/internal/config"
	"palscheduler/internal/dockerctl"
	"palscheduler/internal/palrest"
	"palscheduler/internal/procctl"
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

// provideServerController 依執行方式挑一種「開/關伺服器」的做法：
//
//	Docker 版   → dockerctl（透過 Docker Engine API 開關容器）
//	SteamCMD 版 → procctl（直接管本機行程，完全不需要 Docker）
//
// 切換方式：環境變數 SERVER_DIR 指向伺服器安裝資料夾即為 SteamCMD 版；
// 沒設就維持原本的 Docker 行為，既有部署完全不受影響。
func provideServerController(cfg *config.Config) scheduler.ServerController {
	dir := strings.TrimSpace(os.Getenv("SERVER_DIR"))
	if dir == "" {
		return dockerctl.New(cfg.Docker.Socket, cfg.Docker.ContainerName, cfg.Docker.StopTimeoutSeconds)
	}
	exe := procctl.ResolveExe(dir)
	if exe == "" {
		log.Printf("[warn] SERVER_DIR=%s 底下找不到伺服器執行檔，回頭使用 Docker 控制", dir)
		return dockerctl.New(cfg.Docker.Socket, cfg.Docker.ContainerName, cfg.Docker.StopTimeoutSeconds)
	}
	// 有官方 REST 就用它優雅關服（伺服器會自己先存檔），沒有才送終止訊號。
	var rest procctl.Shutdowner
	if cfg.REST.IsEnabled() {
		rest = palrest.NewClient(cfg.REST.Host, cfg.REST.Port, cfg.REST.Password)
	}
	var args []string
	if v := strings.TrimSpace(os.Getenv("SERVER_ARGS")); v != "" {
		args = strings.Fields(v)
	}
	log.Printf("[procctl] SteamCMD 版：直接控制行程 %s", exe)
	return procctl.New(exe, args, cfg.Docker.StopTimeoutSeconds, rest)
}
