// Package dockerctl 以 Docker Engine API（透過 unix socket）控制 Palworld 伺服器容器。
// 僅使用標準函式庫，實作 scheduler.ServerController 介面：IsRunning / Start / Stop。
package dockerctl

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"time"
)

// Client 控制單一容器。
type Client struct {
	http        *http.Client
	container   string
	stopTimeout int
}

// New 建立一個透過 socket 溝通的 Docker 控制器。
func New(socket, container string, stopTimeoutSeconds int) *Client {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 5 * time.Second}
			return d.DialContext(ctx, "unix", socket)
		},
	}
	if stopTimeoutSeconds <= 0 {
		stopTimeoutSeconds = 30
	}
	return &Client{
		http:        &http.Client{Transport: transport, Timeout: 60 * time.Second},
		container:   container,
		stopTimeout: stopTimeoutSeconds,
	}
}

type containerState struct {
	State struct {
		Running bool   `json:"Running"`
		Status  string `json:"Status"`
	} `json:"State"`
}

// IsRunning 回傳容器是否處於 running 狀態。
func (c *Client) IsRunning() bool {
	req, err := http.NewRequest(http.MethodGet,
		"http://docker/containers/"+url.PathEscape(c.container)+"/json", nil)
	if err != nil {
		log.Printf("[docker] 建立請求失敗: %v", err)
		return false
	}
	resp, err := c.http.Do(req)
	if err != nil {
		log.Printf("[docker] 查詢容器狀態失敗: %v", err)
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("[docker] 查詢容器狀態 HTTP %d: %s", resp.StatusCode, string(body))
		return false
	}
	var st containerState
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		log.Printf("[docker] 解析容器狀態失敗: %v", err)
		return false
	}
	return st.State.Running
}

// Start 啟動容器（已在執行時 Docker 回 304，視為成功）。
func (c *Client) Start() error {
	return c.post("/containers/"+url.PathEscape(c.container)+"/start", "啟動")
}

// Stop 優雅停止容器（送 SIGTERM，逾時才 SIGKILL）；作為 RCON 關服後的保險。
func (c *Client) Stop() {
	path := fmt.Sprintf("/containers/%s/stop?t=%d", url.PathEscape(c.container), c.stopTimeout)
	if err := c.post(path, "停止"); err != nil {
		log.Printf("[docker] 停止容器失敗: %v", err)
	}
}

func (c *Client) post(path, action string) error {
	req, err := http.NewRequest(http.MethodPost, "http://docker"+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%s容器失敗: %w", action, err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusNoContent, http.StatusNotModified:
		return nil
	default:
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s容器 HTTP %d: %s", action, resp.StatusCode, string(body))
	}
}
