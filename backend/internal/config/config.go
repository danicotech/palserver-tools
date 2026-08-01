package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config 對應 config.json 的整體結構。
type Config struct {
	Timezone string         `json:"timezone"` // 排程時區，省略預設 "Asia/Taipei"
	Docker   DockerConfig   `json:"docker"`
	RCON     RCONConfig     `json:"rcon"`
	REST     RESTConfig     `json:"rest"`
	PalSave  PalSaveConfig  `json:"palsave"`
	Runtime  RuntimeConfig  `json:"runtime"`
	Hooks    HooksConfig    `json:"hooks"`
	Schedule ScheduleConfig `json:"schedule"`
	API      APIConfig      `json:"api"`

	loc *time.Location // 由 Timezone 解析而來（validate 時設定），排程一律以此為準
}

// Location 回傳排程使用的時區；一律以設定檔的 timezone 為準，
// 不依賴容器的 TZ 環境變數，避免 tzdata/TZ 缺失時悄悄退回 UTC。
func (c *Config) Location() *time.Location {
	if c.loc != nil {
		return c.loc
	}
	return time.Local
}

// RESTConfig 指向 Palworld 官方 REST API（預設埠 8212）。
// 未填的欄位會沿用 rcon 設定：host 沿用 rcon.host、password 沿用 rcon.password
// （因 REST 的 AdminPassword 與 RCON 密碼在本專案相同）。
type RESTConfig struct {
	Enabled  *bool  `json:"enabled,omitempty"`  // 省略視為 true
	Host     string `json:"host,omitempty"`     // 省略沿用 rcon.host
	Port     int    `json:"port,omitempty"`     // 省略預設 8212
	Password string `json:"password,omitempty"` // 省略沿用 rcon.password（= AdminPassword）
}

// IsEnabled 回報 REST API 整合是否啟用（未設定時預設啟用）。
func (r RESTConfig) IsEnabled() bool { return r.Enabled == nil || *r.Enabled }

// PalSaveConfig 指向存檔解析 sidecar（tools/palsave），提供玩家帕魯資料查詢。
type PalSaveConfig struct {
	Enabled *bool  `json:"enabled,omitempty"` // 省略視為 true
	URL     string `json:"url,omitempty"`     // 省略預設 http://palsave:8213（compose 內網）
}

// IsEnabled 回報存檔解析整合是否啟用（未設定時預設啟用）。
func (p PalSaveConfig) IsEnabled() bool { return p.Enabled == nil || *p.Enabled }

// DockerConfig 指定要控制的 Palworld 伺服器容器。
type DockerConfig struct {
	Socket             string `json:"socket"`             // Docker socket 路徑，容器內通常為 /var/run/docker.sock
	ContainerName      string `json:"containerName"`      // 要開/關的 Palworld 容器名稱
	StopTimeoutSeconds int    `json:"stopTimeoutSeconds"` // docker stop 的優雅等待秒數
}

// APIConfig 控制外部 HTTP 控制介面。
type APIConfig struct {
	Enabled bool   `json:"enabled"`
	Listen  string `json:"listen"` // 例如 "0.0.0.0:9000"（對外）或 "127.0.0.1:9000"（僅本機）
	Token   string `json:"token"`  // 所有請求需帶此 token

	// CORSOrigins 為允許跨源存取的前端來源（供瀏覽器 SPA 使用）。
	// 省略或含 "*" 時，反射請求的 Origin（等同允許全部）；因驗證改用 Authorization
	// 標頭而非 cookie，反射來源不會有 CSRF 風險。例："http://localhost:5173"。
	CORSOrigins []string `json:"corsOrigins,omitempty"`
}

// AllowAllOrigins 回報是否允許任意來源（未設定或設為 "*"）。
func (a APIConfig) AllowAllOrigins() bool {
	if len(a.CORSOrigins) == 0 {
		return true
	}
	for _, o := range a.CORSOrigins {
		if o == "*" {
			return true
		}
	}
	return false
}

// OriginAllowed 回報指定 origin 是否在白名單內。
func (a APIConfig) OriginAllowed(origin string) bool {
	if a.AllowAllOrigins() {
		return true
	}
	for _, o := range a.CORSOrigins {
		if o == origin {
			return true
		}
	}
	return false
}

type RCONConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Password string `json:"password"`
}

// RuntimeConfig 為運行參數（非流程步驟）。
type RuntimeConfig struct {
	KillGraceSeconds    int `json:"killGraceSeconds"`    // 關服流程後再等幾秒才強制停容器
	HealthCheckSeconds  int `json:"healthCheckSeconds"`  // 開放時段內每隔幾秒檢查容器存活（崩潰自動重啟）
	ManualStopCountdown int `json:"manualStopCountdown"` // /api/stop 未帶 countdown 時的預設倒數秒數
}

// HooksConfig 是可由操作者用 JSON array 編排的「開服 / 關服 / 手動關服」流程。
// 每個流程是一連串 Step，依序執行。
type HooksConfig struct {
	OnOpen       []Step `json:"onOpen"`       // 開服時執行
	OnClose      []Step `json:"onClose"`      // 排程關服時執行（結尾對齊 close 時間）
	OnManualStop []Step `json:"onManualStop"` // 由 API /stop 觸發的關服流程
}

// Step 是流程中的一個動作。
//
// type 可用值：
//   - "startContainer"      啟動 Palworld 容器
//   - "stopContainer"       停止 Palworld 容器（docker stop）
//   - "broadcast"           廣播（message）；優先走 REST（支援空白），未啟用時退回 RCON
//   - "wait"                等待 seconds 秒
//   - "countdown"           倒數廣播，見下方欄位說明
//   - "save"                RCON Save
//   - "doexit"              RCON DoExit（立即關閉）
//   - "shutdown"            RCON Shutdown seconds message（由伺服器自行倒數+存檔+關閉）
//   - "rcon"                任意 RCON 指令（command）
//   - "info" / "showplayers" 查詢類指令（結果寫入日誌）
//
// countdown 步驟支援兩種寫法（可混用，全部只需改 JSON）：
//  1. 宣告式（建議）：用 announce 陣列列出「剩餘幾秒要廣播什麼」，
//     再用 tickFromSeconds 設定最後幾秒逐秒倒數。例如
//     { "type":"countdown",
//     "announce":[
//     {"at":1800,"message":"伺服器將於 30 分鐘後關閉"},
//     {"at":600, "message":"伺服器將於 10 分鐘後關閉"},
//     {"at":300, "message":"伺服器將於 5 分鐘後關閉"},
//     {"at":60,  "message":"伺服器將於 1 分鐘後關閉"}
//     ],
//     "tickFromSeconds":15, "tickPrefix":"伺服器將於" }
//     → 於剩 30/10/5/1 分各廣播一次，最後 15 秒每秒倒數「伺服器將於 15」…「伺服器將於 1」。
//  2. 簡易式（相容舊設定）：fromSeconds + prefix → 最後 fromSeconds 秒逐秒廣播。
//
// 整個倒數的總長 = announce 最大的 at 與 fromSeconds/tickFromSeconds 取最大值；
// 排程會據此提前啟動，使倒數結尾正好對齊關服時間。
type Step struct {
	Type        string `json:"type"`
	Message     string `json:"message,omitempty"`
	Seconds     int    `json:"seconds,omitempty"`
	FromSeconds int    `json:"fromSeconds,omitempty"`
	Prefix      string `json:"prefix,omitempty"`
	Command     string `json:"command,omitempty"`

	// countdown 進階欄位
	Announce        []Announce `json:"announce,omitempty"`
	TickFromSeconds int        `json:"tickFromSeconds,omitempty"`
	TickPrefix      string     `json:"tickPrefix,omitempty"`
	TickEndMessage  string     `json:"tickEndMessage,omitempty"` // 倒數到 0 時再廣播一則收尾訊息（如「伺服器關閉！」）
}

// Announce 是 countdown 中的一個廣播點：在距離關服剩餘 At 秒時送出 Message。
type Announce struct {
	At      int    `json:"at"`      // 剩餘秒數
	Message string `json:"message"` // 廣播內容（REST 送出，支援空白）
}

type ScheduleConfig struct {
	Windows []Window `json:"windows"`
}

// Window 是一個「開放時段」。open/close 為 "HH:MM"，close 若 <= open 視為隔天。
type Window struct {
	Label string   `json:"label"`
	Days  []string `json:"days"`
	Open  string   `json:"open"`
	Close string   `json:"close"`
}

// Load 讀取並驗證設定檔。
func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("讀取設定檔失敗: %w", err)
	}
	var c Config
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("解析 config.json 失敗: %w", err)
	}
	applyEnvOverrides(&c)
	if err := c.validate(); err != nil {
		return nil, err
	}
	return &c, nil
}

// applyEnvOverrides 讓「同一份 config.json」也能用在 SteamCMD 版：
// Docker 版的預設值是 compose 內網名稱（palsave、palworld），本機直跑時
// 用環境變數指到 127.0.0.1 即可，不必另外維護一份設定檔。
func applyEnvOverrides(c *Config) {
	if v := strings.TrimSpace(os.Getenv("PALSAVE_URL")); v != "" {
		c.PalSave.URL = v
	}
	if v := strings.TrimSpace(os.Getenv("REST_HOST")); v != "" {
		c.REST.Host = v
	}
	if v := strings.TrimSpace(os.Getenv("RCON_HOST")); v != "" {
		c.RCON.Host = v
	}
	if v := strings.TrimSpace(os.Getenv("API_LISTEN")); v != "" {
		c.API.Listen = v
	}
}

func (c *Config) validate() error {
	if c.Docker.ContainerName == "" {
		return fmt.Errorf("docker.containerName 不可為空")
	}
	if c.Docker.Socket == "" {
		c.Docker.Socket = "/var/run/docker.sock"
	}
	// 時區：一律以設定檔為準。載入失敗（多半是容器缺 tzdata）就明確報錯，
	// 而非讓 time.Local 悄悄退回 UTC 導致排程整整偏移。
	if c.Timezone == "" {
		c.Timezone = "Asia/Taipei"
	}
	loc, err := time.LoadLocation(c.Timezone)
	if err != nil {
		return fmt.Errorf("timezone %q 載入失敗（請確認容器已安裝 tzdata）: %w", c.Timezone, err)
	}
	c.loc = loc
	// REST 預設值：沿用 rcon 的 host/password，埠預設 8212。
	if c.REST.Port == 0 {
		c.REST.Port = 8212
	}
	if c.REST.Host == "" {
		c.REST.Host = c.RCON.Host
	}
	if c.REST.Password == "" {
		c.REST.Password = c.RCON.Password
	}
	if c.PalSave.URL == "" {
		c.PalSave.URL = "http://palsave:8213"
	}
	if len(c.Schedule.Windows) == 0 {
		return fmt.Errorf("schedule.windows 不可為空")
	}
	for i, w := range c.Schedule.Windows {
		if _, _, err := ParseHM(w.Open); err != nil {
			return fmt.Errorf("windows[%d].open 格式錯誤: %w", i, err)
		}
		if _, _, err := ParseHM(w.Close); err != nil {
			return fmt.Errorf("windows[%d].close 格式錯誤: %w", i, err)
		}
		for _, d := range w.Days {
			if _, err := ParseWeekday(d); err != nil {
				return fmt.Errorf("windows[%d].days 有無效值 %q: %w", i, d, err)
			}
		}
	}
	return nil
}

// ParseHM 解析 "HH:MM"，回傳時、分。
func ParseHM(s string) (int, int, error) {
	parts := strings.SplitN(strings.TrimSpace(s), ":", 2)
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("需為 HH:MM，收到 %q", s)
	}
	h, err := strconv.Atoi(parts[0])
	if err != nil || h < 0 || h > 23 {
		return 0, 0, fmt.Errorf("時 (0-23) 無效: %q", parts[0])
	}
	m, err := strconv.Atoi(parts[1])
	if err != nil || m < 0 || m > 59 {
		return 0, 0, fmt.Errorf("分 (0-59) 無效: %q", parts[1])
	}
	return h, m, nil
}

// ParseWeekday 支援 Mon/Tue/... 或英文全名，大小寫不拘。
func ParseWeekday(s string) (time.Weekday, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "sun", "sunday":
		return time.Sunday, nil
	case "mon", "monday":
		return time.Monday, nil
	case "tue", "tues", "tuesday":
		return time.Tuesday, nil
	case "wed", "weds", "wednesday":
		return time.Wednesday, nil
	case "thu", "thur", "thurs", "thursday":
		return time.Thursday, nil
	case "fri", "friday":
		return time.Friday, nil
	case "sat", "saturday":
		return time.Saturday, nil
	}
	return 0, fmt.Errorf("無法辨識的星期: %q", s)
}
