// 存檔資料的定時預熱快取。
//
// 為什麼要有這個:解析一份大存檔要十幾秒,若等到有人打開網站才去解，
// 第一位訪客就得乾等；解析期間又有第二個人進來還會再排一次。
// 這裡在後端起一個排程,每隔一段時間主動去 palsave 抓一份完整結果留著，
// /api/pals 直接回快取,對訪客而言永遠是即時的。
//
// ⚠️ 快取一律寫在伺服器端(backend/data/,已 gitignore),
// 絕對不要寫進 frontend 的 public/ —— 那個目錄會被原樣複製進 dist，
// 等於把全服玩家資料公開成一個可直接下載的靜態檔。
package api

import (
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type palsCache struct {
	mu        sync.RWMutex
	body      []byte
	fetchedAt time.Time

	url      string        // palsave 的 /pals 完整網址
	path     string        // 落地檔路徑;空字串 = 只放記憶體
	interval time.Duration // 重新整理間隔
	http     *http.Client
}

func newPalsCache(baseURL, file string, interval time.Duration) *palsCache {
	return &palsCache{
		url:      baseURL + "/pals",
		path:     file,
		interval: interval,
		// 解析大存檔可能要十幾秒,逾時給寬一點
		http: &http.Client{Timeout: 180 * time.Second},
	}
}

// Get 回傳目前快取(可能為 nil)與它的產生時間。
func (p *palsCache) Get() ([]byte, time.Time) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.body, p.fetchedAt
}

// Run 先載入上次落地的快取(讓重啟後立刻有資料可回),
// 接著立即抓一次,之後每 interval 抓一次,直到 stop 關閉。
func (p *palsCache) Run(stop <-chan struct{}) {
	p.loadFile()
	p.refresh()
	t := time.NewTicker(p.interval)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			p.refresh()
		}
	}
}

func (p *palsCache) refresh() {
	start := time.Now()
	resp, err := p.http.Get(p.url)
	if err != nil {
		log.Printf("[pals-cache] 抓取失敗:%v(維持上一份快取)", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("[pals-cache] palsave 回 %d(維持上一份快取)", resp.StatusCode)
		return
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil || len(body) == 0 {
		log.Printf("[pals-cache] 讀取回應失敗:%v", err)
		return
	}
	p.mu.Lock()
	p.body = body
	p.fetchedAt = time.Now()
	p.mu.Unlock()
	log.Printf("[pals-cache] 已更新(%d KB,耗時 %.1fs)", len(body)/1024, time.Since(start).Seconds())
	p.saveFile(body)
}

// loadFile 讀取上次落地的快取;失敗就當作沒有(不是錯誤)。
func (p *palsCache) loadFile() {
	if p.path == "" {
		return
	}
	b, err := os.ReadFile(p.path)
	if err != nil || len(b) == 0 {
		return
	}
	st, err := os.Stat(p.path)
	p.mu.Lock()
	p.body = b
	if err == nil {
		p.fetchedAt = st.ModTime()
	}
	p.mu.Unlock()
	log.Printf("[pals-cache] 載入上次的快取(%d KB)", len(b)/1024)
}

// saveFile 以「先寫暫存再改名」落地,避免寫到一半被讀到半截 JSON。
func (p *palsCache) saveFile(body []byte) {
	if p.path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(p.path), 0o755); err != nil {
		return
	}
	tmp := p.path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		log.Printf("[pals-cache] 落地失敗:%v", err)
		return
	}
	if err := os.Rename(tmp, p.path); err != nil {
		log.Printf("[pals-cache] 落地改名失敗:%v", err)
		_ = os.Remove(tmp)
	}
}
