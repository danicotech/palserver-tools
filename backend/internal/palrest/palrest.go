// Package palrest 是 Palworld 專用伺服器「官方 REST API」的 Go 用戶端。
//
// 官方文件：https://docs.palworldgame.com/api/rest-api/palwold-rest-api/
//
// 啟用方式（本專案已在 docker-compose.yml 設定）：
//   - PalWorldSettings.ini： RESTAPIEnabled=True、RESTAPIPort=8212
//   - 對應環境變數：         REST_API_ENABLED=true、REST_API_PORT=8212
//   - 認證：HTTP Basic Auth，帳號固定為 "admin"，密碼為 AdminPassword
//   - Base URL： http://<host>:8212/v1/api
//
// ⚠️ 安全性：官方明言此 API「不應直接對外網開放」，請只綁 127.0.0.1 或內網，
//
//	並用防火牆限制來源；它等同伺服器管理員後台。
//
// 本套件僅使用標準函式庫。
package palrest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client 是 Palworld REST API 用戶端。用 NewClient 建立。
type Client struct {
	baseURL  string // 例如 http://127.0.0.1:8212/v1/api
	password string // AdminPassword
	http     *http.Client
}

// Option 用於自訂 Client。
type Option func(*Client)

// WithHTTPClient 覆寫預設的 http.Client（例如自訂逾時或 Transport）。
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) { c.http = h }
}

// WithTimeout 設定單次請求逾時（預設 10 秒）。
func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.http.Timeout = d }
}

// NewClient 建立用戶端。
//
//	host：伺服器位址，如 "127.0.0.1" 或 compose 內網服務名 "palworld"
//	port：REST API 埠，通常 8212
//	adminPassword：伺服器的 AdminPassword
func NewClient(host string, port int, adminPassword string, opts ...Option) *Client {
	c := &Client{
		baseURL:  fmt.Sprintf("http://%s:%d/v1/api", host, port),
		password: adminPassword,
		http:     &http.Client{Timeout: 10 * time.Second},
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// ---- 回應型別 ----

// ServerInfo 對應 GET /info。
type ServerInfo struct {
	Version     string `json:"version"`
	ServerName  string `json:"servername"`
	Description string `json:"description"`
	WorldGUID   string `json:"worldguid"`
}

// Player 對應 GET /players 回傳陣列中的單一玩家。
type Player struct {
	Name          string  `json:"name"`
	AccountName   string  `json:"accountName"`
	PlayerID      string  `json:"playerId"`
	UserID        string  `json:"userId"`
	IP            string  `json:"ip"`
	Ping          float64 `json:"ping"`
	LocationX     float64 `json:"location_x"`
	LocationY     float64 `json:"location_y"`
	Level         int     `json:"level"`
	BuildingCount int     `json:"building_count"`
}

// Metrics 對應 GET /metrics。
type Metrics struct {
	ServerFPS        int     `json:"serverfps"`
	CurrentPlayerNum int     `json:"currentplayernum"`
	ServerFrameTime  float64 `json:"serverframetime"`
	MaxPlayerNum     int     `json:"maxplayernum"`
	UptimeSeconds    int     `json:"uptime"`
	BaseCampNum      int     `json:"basecampnum"`
	Days             int     `json:"days"`
}

// Settings 是 GET /settings 回傳的伺服器設定。欄位眾多且會隨版本增加，
// 故以動態 map 表示；取值例如 s["ExpRate"]、s["ServerName"]。
type Settings map[string]any

// ---- API 方法 ----

// Info 取得伺服器資訊（版本、名稱、世界 GUID）。GET /info
func (c *Client) Info(ctx context.Context) (*ServerInfo, error) {
	var out ServerInfo
	if err := c.do(ctx, http.MethodGet, "/info", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Players 取得目前連線中的玩家列表。GET /players
func (c *Client) Players(ctx context.Context) ([]Player, error) {
	var out struct {
		Players []Player `json:"players"`
	}
	if err := c.do(ctx, http.MethodGet, "/players", nil, &out); err != nil {
		return nil, err
	}
	return out.Players, nil
}

// Settings 取得目前伺服器設定。GET /settings
func (c *Client) Settings(ctx context.Context) (Settings, error) {
	var out Settings
	if err := c.do(ctx, http.MethodGet, "/settings", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Metrics 取得伺服器即時指標（FPS、線上人數、運行時間等）。GET /metrics
func (c *Client) Metrics(ctx context.Context) (*Metrics, error) {
	var out Metrics
	if err := c.do(ctx, http.MethodGet, "/metrics", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Announce 在伺服器內廣播訊息。POST /announce
func (c *Client) Announce(ctx context.Context, message string) error {
	body := map[string]any{"message": message}
	return c.do(ctx, http.MethodPost, "/announce", body, nil)
}

// Kick 踢出玩家。userID 例如 "steam_0000..."，message 為顯示原因。POST /kick
func (c *Client) Kick(ctx context.Context, userID, message string) error {
	body := map[string]any{"userid": userID, "message": message}
	return c.do(ctx, http.MethodPost, "/kick", body, nil)
}

// Ban 封鎖玩家。POST /ban
func (c *Client) Ban(ctx context.Context, userID, message string) error {
	body := map[string]any{"userid": userID, "message": message}
	return c.do(ctx, http.MethodPost, "/ban", body, nil)
}

// Unban 解除封鎖。POST /unban
func (c *Client) Unban(ctx context.Context, userID string) error {
	body := map[string]any{"userid": userID}
	return c.do(ctx, http.MethodPost, "/unban", body, nil)
}

// Save 存檔世界。POST /save
func (c *Client) Save(ctx context.Context) error {
	return c.do(ctx, http.MethodPost, "/save", nil, nil)
}

// Shutdown 在 waitSeconds 秒後關閉伺服器，並向玩家顯示 message。POST /shutdown
func (c *Client) Shutdown(ctx context.Context, waitSeconds int, message string) error {
	body := map[string]any{"waittime": waitSeconds, "message": message}
	return c.do(ctx, http.MethodPost, "/shutdown", body, nil)
}

// Stop 立即強制停止伺服器（不等待、不通知）。POST /stop
func (c *Client) Stop(ctx context.Context) error {
	return c.do(ctx, http.MethodPost, "/stop", nil, nil)
}

// ---- 內部：送出請求 ----

// do 送出一次請求。reqBody 為 nil 時不帶 body；out 為 nil 時忽略回應內容。
func (c *Client) do(ctx context.Context, method, path string, reqBody any, out any) error {
	var bodyReader io.Reader
	if reqBody != nil {
		b, err := json.Marshal(reqBody)
		if err != nil {
			return fmt.Errorf("序列化請求失敗: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("建立請求失敗: %w", err)
	}
	req.SetBasicAuth("admin", c.password) // 官方固定帳號 admin，密碼為 AdminPassword
	req.Header.Set("Accept", "application/json")
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("請求 %s %s 失敗: %w", method, path, err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(data))
		switch resp.StatusCode {
		case http.StatusUnauthorized:
			return fmt.Errorf("認證失敗 (401)：請確認 AdminPassword 正確、REST API 已啟用")
		default:
			return fmt.Errorf("%s %s 回應 %d: %s", method, path, resp.StatusCode, msg)
		}
	}

	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("解析回應失敗: %w (原始內容: %s)", err, string(data))
		}
	}
	return nil
}
