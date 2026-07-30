// Package roster 保存「玩家頭像共用名冊」：玩家自己輸入名字 + 選一隻帕魯當頭像，
// 所有人都看得到。以 JSON 持久化（重啟不遺失），寫入採暫存檔 + rename 原子替換。
package roster

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Entry 是一位玩家的頭像設定。
type Entry struct {
	Name      string `json:"name"`      // 顯示名稱（玩家自填）
	PalID     string `json:"palId"`     // 帕魯內部代號（頭像）
	UpdatedAt int64  `json:"updatedAt"` // 最後更新（unix 秒）
}

// Store 是名冊儲存。以正規化名稱為 key 去重。
type Store struct {
	path    string
	mu      sync.Mutex
	entries map[string]*Entry
}

// New 建立 Store 並嘗試載入既有名冊。
func New(path string) *Store {
	s := &Store{path: path, entries: map[string]*Entry{}}
	s.load()
	return s
}

func key(name string) string { return strings.ToLower(strings.TrimSpace(name)) }

func (s *Store) load() {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return // 首次啟動無檔屬正常
	}
	var m map[string]*Entry
	if err := json.Unmarshal(b, &m); err != nil {
		log.Printf("[roster] 載入 %s 失敗，將重新開始: %v", s.path, err)
		return
	}
	if m != nil {
		s.entries = m
	}
}

// save 需在持有 mu 時呼叫。以暫存檔 + rename 做原子寫入。
func (s *Store) save() {
	if dir := filepath.Dir(s.path); dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}
	b, err := json.Marshal(s.entries)
	if err != nil {
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		log.Printf("[roster] 寫入 %s 失敗: %v", s.path, err)
		return
	}
	_ = os.Rename(tmp, s.path)
}

// Set 新增/更新一位玩家的頭像（依名稱正規化去重）。name/palID 皆非空才成功。
func (s *Store) Set(name, palID string) (Entry, bool) {
	name = strings.TrimSpace(name)
	palID = strings.TrimSpace(palID)
	if name == "" || palID == "" {
		return Entry{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e := &Entry{Name: name, PalID: palID, UpdatedAt: time.Now().Unix()}
	s.entries[key(name)] = e
	s.save()
	return *e, true
}

// Get 回傳全部名冊，依更新時間新→舊排序。
func (s *Store) Get() []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Entry, 0, len(s.entries))
	for _, e := range s.entries {
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}
