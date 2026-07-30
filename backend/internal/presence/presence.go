// Package presence 追蹤玩家「上線時數 / 上線次數」。
//
// 存檔與官方 REST 都只有即時快照，沒有歷史；本套件以固定間隔輪詢
// /players，累計每位玩家的線上總秒數與上線段數（session），並以 JSON
// 持久化（重啟不遺失）。資料自「啟用當下」開始累積，無法回溯歷史。
package presence

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"palscheduler/internal/palrest"
)

// Fetcher 為取得目前線上玩家的來源（由 *palrest.Client 實作）。
type Fetcher interface {
	Players(ctx context.Context) ([]palrest.Player, error)
}

// Record 是每位玩家的累計資料（持久化用）。
type Record struct {
	UserID           string    `json:"userId"`
	Name             string    `json:"name"`
	TotalSeconds     int64     `json:"totalSeconds"`               // 線上總秒數（近似：每輪在線 +間隔）
	Sessions         int       `json:"sessions"`                   // 上線段數（登入次數）
	FirstSeen        int64     `json:"firstSeen"`                  // 首次觀測到（unix 秒）
	LastSeen         int64     `json:"lastSeen"`                   // 最後一次在線（unix 秒）
	CurrentSessStart int64     `json:"currentSessStart,omitempty"` // 本次上線起始（unix 秒）；離線後不重設，僅在線時有意義
	HourSecs         [24]int64 `json:"hourSecs"`                   // 各時段（0-23 時，依設定時區）線上秒數
	WeekSecs         [7]int64  `json:"weekSecs"`                   // 各星期（0=週日..6=週六）線上秒數
}

type store struct {
	TrackingSince int64              `json:"trackingSince"`
	Records       map[string]*Record `json:"records"`
}

// Tracker 週期性輪詢並累計上線資料。
type Tracker struct {
	fetch    Fetcher
	path     string
	interval time.Duration
	loc      *time.Location // 時段/星期歸戶所用時區

	mu      sync.Mutex
	data    store
	present map[string]bool // 上一輪在線者，用於偵測新 session
}

// New 建立 Tracker 並嘗試載入既有資料。loc 為時段/星期歸戶時區（nil 用 time.Local）。
func New(fetch Fetcher, path string, interval time.Duration, loc *time.Location) *Tracker {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	if loc == nil {
		loc = time.Local
	}
	t := &Tracker{
		fetch:    fetch,
		path:     path,
		interval: interval,
		loc:      loc,
		data:     store{Records: map[string]*Record{}},
		present:  map[string]bool{},
	}
	t.load()
	if t.data.TrackingSince == 0 {
		t.data.TrackingSince = time.Now().Unix()
	}
	return t
}

func (t *Tracker) load() {
	b, err := os.ReadFile(t.path)
	if err != nil {
		return // 首次啟動無檔屬正常
	}
	var s store
	if err := json.Unmarshal(b, &s); err != nil {
		log.Printf("[presence] 載入 %s 失敗，將重新開始: %v", t.path, err)
		return
	}
	if s.Records == nil {
		s.Records = map[string]*Record{}
	}
	t.data = s
}

// save 需在持有 mu 時呼叫。以暫存檔 + rename 做原子寫入。
func (t *Tracker) save() {
	if dir := filepath.Dir(t.path); dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}
	b, err := json.Marshal(t.data)
	if err != nil {
		return
	}
	tmp := t.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		log.Printf("[presence] 寫入 %s 失敗: %v", t.path, err)
		return
	}
	_ = os.Rename(tmp, t.path)
}

// Run 啟動輪詢，直到 stop 關閉。
func (t *Tracker) Run(stop <-chan struct{}) {
	log.Printf("[presence] 上線追蹤啟動：每 %s 輪詢，資料 %s", t.interval, t.path)
	tk := time.NewTicker(t.interval)
	defer tk.Stop()
	t.poll() // 啟動時先跑一次
	for {
		select {
		case <-stop:
			t.mu.Lock()
			t.save()
			t.mu.Unlock()
			return
		case <-tk.C:
			t.poll()
		}
	}
}

func (t *Tracker) poll() {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	players, err := t.fetch.Players(ctx)
	if err != nil {
		// 伺服器休息 / 未開放時取不到玩家屬正常，保留上一輪狀態（不清空 present）。
		return
	}
	now := time.Now()
	sec := int64(t.interval / time.Second)

	t.mu.Lock()
	defer t.mu.Unlock()
	nowOnline := make(map[string]bool, len(players))
	for _, p := range players {
		id := p.UserID
		if id == "" {
			id = p.PlayerID
		}
		if id == "" {
			continue
		}
		nowOnline[id] = true
		r := t.data.Records[id]
		if r == nil {
			r = &Record{UserID: id, FirstSeen: now.Unix()}
			t.data.Records[id] = r
		}
		if p.Name != "" {
			r.Name = p.Name
		}
		if !t.present[id] {
			r.Sessions++                    // 由離線轉為在線 = 新的一段上線
			r.CurrentSessStart = now.Unix() // 記錄本次上線起始
		}
		r.TotalSeconds += sec
		r.LastSeen = now.Unix()
		ln := now.In(t.loc) // 依設定時區歸戶時段/星期
		r.HourSecs[ln.Hour()] += sec
		r.WeekSecs[int(ln.Weekday())] += sec
	}
	t.present = nowOnline
	t.save()
}

// PlayerStat 是對外回應的單筆統計。
type PlayerStat struct {
	UserID                string    `json:"userId"`
	Name                  string    `json:"name"`
	OnlineSeconds         int64     `json:"onlineSeconds"`
	Sessions              int       `json:"sessions"`
	AvgSessionSeconds     int64     `json:"avgSessionSeconds"`
	CurrentSessionSeconds int64     `json:"currentSessionSeconds"` // 本次上線時長（僅在線時 >0）
	HourSecs              [24]int64 `json:"hourSecs"`              // 各時段線上秒數（0-23 時）
	WeekSecs              [7]int64  `json:"weekSecs"`              // 各星期線上秒數（0=週日..6=週六）
	FirstSeen             int64     `json:"firstSeen"`
	LastSeen              int64     `json:"lastSeen"`
	Online                bool      `json:"online"`
}

// Snapshot 回傳依線上總時數排序（多→少）的統計。
func (t *Tracker) Snapshot() map[string]any {
	t.mu.Lock()
	defer t.mu.Unlock()
	nowUnix := time.Now().Unix()
	freshWindow := 2 * int64(t.interval/time.Second)
	out := make([]PlayerStat, 0, len(t.data.Records))
	for id, r := range t.data.Records {
		avg := int64(0)
		if r.Sessions > 0 {
			avg = r.TotalSeconds / int64(r.Sessions)
		}
		online := nowUnix-r.LastSeen <= freshWindow
		cur := int64(0)
		if online && r.CurrentSessStart > 0 {
			if cur = nowUnix - r.CurrentSessStart; cur < 0 {
				cur = 0
			}
		}
		out = append(out, PlayerStat{
			UserID:                id,
			Name:                  r.Name,
			OnlineSeconds:         r.TotalSeconds,
			Sessions:              r.Sessions,
			AvgSessionSeconds:     avg,
			CurrentSessionSeconds: cur,
			HourSecs:              r.HourSecs,
			WeekSecs:              r.WeekSecs,
			FirstSeen:             r.FirstSeen,
			LastSeen:              r.LastSeen,
			Online:                online,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].OnlineSeconds != out[j].OnlineSeconds {
			return out[i].OnlineSeconds > out[j].OnlineSeconds
		}
		return out[i].Name < out[j].Name
	})
	return map[string]any{
		"trackingSince": t.data.TrackingSince,
		"pollSeconds":   int64(t.interval / time.Second),
		"players":       out,
	}
}
