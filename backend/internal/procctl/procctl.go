// Package procctl 直接以「行程」控制 Palworld 伺服器，供不安裝 Docker 的
// SteamCMD 版使用。它實作與 dockerctl 相同的 scheduler.ServerController 介面
// （IsRunning / Start / Stop），所以排程器本體完全不必知道兩者的差別。
//
// 關服順序刻意做兩段：
//  1. 先請伺服器自己存檔並優雅關閉（官方 REST /shutdown，需 RESTAPIEnabled）
//  2. 等不到就送 taskkill / SIGTERM，最後才 SIGKILL
//
// 這樣一般情況下不會掉存檔；只有伺服器完全沒回應才會硬殺。
package procctl

import (
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Shutdowner 是「請伺服器自己優雅關閉」的能力，由 palrest.Client 實作。
// 傳 nil 代表沒有 REST API 可用，關服會直接走送訊號的路徑。
type Shutdowner interface {
	Shutdown(ctx context.Context, seconds int, message string) error
}

// Client 以行程方式控制一台本機 Palworld 伺服器。
type Client struct {
	exePath     string   // 伺服器執行檔完整路徑
	args        []string // 啟動參數
	stopTimeout time.Duration
	rest        Shutdowner

	mu  sync.Mutex
	cmd *exec.Cmd // 由本程式啟動的行程（重啟排程器後會是 nil，改用掃描判斷）
}

// New 建立行程控制器。
//
//	exePath  伺服器執行檔（Windows: PalServer.exe；Linux: PalServer.sh）
//	args     啟動參數；留空用官方建議的預設值
//	stopTimeoutSeconds  優雅關閉等待秒數（<=0 視為 30）
//	rest     官方 REST 用戶端，用來請伺服器自己存檔關閉；沒有就傳 nil
func New(exePath string, args []string, stopTimeoutSeconds int, rest Shutdowner) *Client {
	if len(args) == 0 {
		args = []string{"-publicport=8211", "-useperfthreads", "-NoAsyncLoadingThread", "-UseMultithreadForDS"}
	}
	if stopTimeoutSeconds <= 0 {
		stopTimeoutSeconds = 30
	}
	return &Client{
		exePath:     exePath,
		args:        args,
		stopTimeout: time.Duration(stopTimeoutSeconds) * time.Second,
		rest:        rest,
	}
}

// processNames 是實際跑起來的伺服器行程名（PalServer.exe 只是啟動器）。
func processNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"PalServer-Win64-Shipping-Cmd.exe", "PalServer-Win64-Shipping.exe", "PalServer.exe"}
	}
	return []string{"PalServer-Linux-Shipping", "PalServer.sh"}
}

// IsRunning 掃描行程表判斷伺服器是否在跑。
// 用掃描而不是只看自己啟動的那個 cmd，是為了讓排程器重啟後仍認得既有的伺服器。
func (c *Client) IsRunning() bool {
	for _, name := range processNames() {
		if processExists(name) {
			return true
		}
	}
	return false
}

// Start 啟動伺服器；已經在跑就直接回 nil。
func (c *Client) Start() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.IsRunning() {
		return nil
	}
	cmd := exec.Command(c.exePath, c.args...)
	cmd.Dir = filepath.Dir(c.exePath)
	// 不繼承本程式的 stdin/stdout，避免排程器結束時把伺服器一起帶走
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	c.cmd = cmd
	go func() { _ = cmd.Wait() }() // 收屍，避免殭屍行程
	log.Printf("[procctl] 已啟動 %s", c.exePath)
	return nil
}

// Stop 關閉伺服器：先請它自己存檔優雅關閉，逾時才送訊號。
func (c *Client) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.IsRunning() {
		return
	}

	// 1) 官方 REST：伺服器會自己存檔再關
	if c.rest != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := c.rest.Shutdown(ctx, 1, "server shutting down")
		cancel()
		if err == nil && c.waitGone(c.stopTimeout) {
			log.Printf("[procctl] 伺服器已優雅關閉")
			c.cmd = nil
			return
		}
		if err != nil {
			log.Printf("[procctl] REST 關服失敗(%v),改用送訊號", err)
		}
	}

	// 2) 送終止訊號（Windows: taskkill /t；其他: SIGTERM）
	for _, name := range processNames() {
		terminate(name)
	}
	if c.waitGone(c.stopTimeout) {
		log.Printf("[procctl] 伺服器已停止")
		c.cmd = nil
		return
	}

	// 3) 最後手段
	for _, name := range processNames() {
		kill(name)
	}
	c.waitGone(10 * time.Second)
	log.Printf("[procctl] 伺服器已強制停止")
	c.cmd = nil
}

// waitGone 等到所有伺服器行程都不見為止；逾時回 false。
func (c *Client) waitGone(d time.Duration) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if !c.IsRunning() {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return !c.IsRunning()
}

// ---- 平台相關的行程操作（只用標準函式庫，靠系統內建工具）----

func processExists(name string) bool {
	if runtime.GOOS == "windows" {
		out, err := exec.Command("tasklist", "/fi", "imagename eq "+name, "/nh").Output()
		if err != nil {
			return false
		}
		return strings.Contains(string(out), name)
	}
	// pgrep -x 需完全比對行程名；找不到會回非 0
	return exec.Command("pgrep", "-x", name).Run() == nil
}

func terminate(name string) {
	if runtime.GOOS == "windows" {
		_ = exec.Command("taskkill", "/im", name, "/t").Run()
		return
	}
	_ = exec.Command("pkill", "-TERM", "-x", name).Run()
}

func kill(name string) {
	if runtime.GOOS == "windows" {
		_ = exec.Command("taskkill", "/im", name, "/t", "/f").Run()
		return
	}
	_ = exec.Command("pkill", "-KILL", "-x", name).Run()
}

// ResolveExe 由伺服器安裝資料夾推出執行檔路徑；找不到回空字串。
func ResolveExe(serverDir string) string {
	candidates := []string{"PalServer.exe"}
	if runtime.GOOS != "windows" {
		candidates = []string{"PalServer.sh"}
	}
	for _, name := range candidates {
		p := filepath.Join(serverDir, name)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}
