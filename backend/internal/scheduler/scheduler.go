// Package scheduler 依開放時段控制伺服器開/關；開服與關服流程皆由 config.Hooks
// 的 JSON array（Step 序列）驅動，關服前可廣播/倒數通知玩家，開放時段內監控容器、
// 崩潰自動重啟，並支援由外部 API 手動覆寫（強制開 / 強制關 / 恢復自動）與完整 RCON。
package scheduler

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"palscheduler/internal/config"
	"palscheduler/internal/palrest"
	"palscheduler/internal/rcon"
)

const (
	rconTimeout = 5 * time.Second
	restTimeout = 8 * time.Second
)

// ServerController 抽象「開/關 Palworld 伺服器」的能力，由 dockerctl.Client 實作。
type ServerController interface {
	IsRunning() bool
	Start() error
	Stop()
}

// Mode 是目前的控制模式。
type Mode int

const (
	ModeAuto     Mode = iota // 依排程自動開關
	ModeForceOn              // 手動強制開啟
	ModeForceOff             // 手動強制關閉
)

func (m Mode) String() string {
	switch m {
	case ModeForceOn:
		return "FORCE_ON"
	case ModeForceOff:
		return "FORCE_OFF"
	default:
		return "AUTO"
	}
}

// Session 是一個具體的開放時段（絕對時間）。
type Session struct {
	Label string
	Open  time.Time
	Close time.Time
}

func (s Session) key() string {
	return fmt.Sprintf("%s@%s", s.Label, s.Open.Format(time.RFC3339))
}

// Status 是回報給 API 的狀態快照。
type Status struct {
	Mode            string `json:"mode"`
	ServerRunning   bool   `json:"serverRunning"`
	InOpenWindow    bool   `json:"inOpenWindow"`
	CurrentLabel    string `json:"currentLabel,omitempty"`
	CurrentCloseAt  string `json:"currentCloseAt,omitempty"`
	NextOpenLabel   string `json:"nextOpenLabel,omitempty"`
	NextOpenAt      string `json:"nextOpenAt,omitempty"`
	ServerTimeLocal string `json:"serverTimeLocal"`
}

// Scheduler 主控。可變狀態受 mu 保護。
type Scheduler struct {
	cfg  *config.Config
	srv  ServerController
	loc  *time.Location  // 排程時區（來自 cfg.Location()），不依賴容器 TZ
	rest *palrest.Client // 官方 REST 用戶端；廣播優先走此，未啟用時為 nil

	mu            sync.Mutex
	mode          Mode
	stopCountdown int // /api/stop 指定的倒數秒數；<0 用預設

	openedKey string // 已執行 OnOpen 的時段 key（避免重複開服）

	wake chan struct{}
}

// New 建立排程器。ctrl 為伺服器控制器（正式環境注入 dockerctl.Client）。
func New(cfg *config.Config, ctrl ServerController) *Scheduler {
	s := &Scheduler{
		cfg:           cfg,
		srv:           ctrl,
		loc:           cfg.Location(),
		mode:          ModeAuto,
		stopCountdown: -1,
		wake:          make(chan struct{}, 1),
	}
	if cfg.REST.IsEnabled() {
		s.rest = palrest.NewClient(cfg.REST.Host, cfg.REST.Port, cfg.REST.Password)
	}
	return s
}

// now 回傳「排程時區」的現在時間。所有排程判斷都用它，
// 確保不論容器 TZ 為何，時段一律以設定的時區（預設台灣）計算。
func (s *Scheduler) now() time.Time { return time.Now().In(s.loc) }

// ---- 外部 API 控制方法 ----

func (s *Scheduler) ForceStart() {
	s.mu.Lock()
	s.mode = ModeForceOn
	s.mu.Unlock()
	log.Println("[API] 強制開啟")
	s.signalWake()
}

// ForceStop 手動關服；countdown<=0 時使用預設倒數秒數。
func (s *Scheduler) ForceStop(countdown int) {
	s.mu.Lock()
	s.mode = ModeForceOff
	s.stopCountdown = countdown
	s.mu.Unlock()
	log.Printf("[API] 強制關閉（倒數 %d 秒）", countdown)
	s.signalWake()
}

func (s *Scheduler) ResumeAuto() {
	s.mu.Lock()
	s.mode = ModeAuto
	s.openedKey = ""
	s.mu.Unlock()
	log.Println("[API] 恢復自動排程")
	s.signalWake()
}

// Rcon 送出任意 RCON 指令（完整 RCON 能力的通用入口）。
func (s *Scheduler) Rcon(command string) (string, error) {
	return rcon.Send(s.cfg.RCON.Host, s.cfg.RCON.Port, s.cfg.RCON.Password, command, rconTimeout)
}

// Status 回傳目前狀態快照。
func (s *Scheduler) Status() Status {
	now := s.now()
	sessions := BuildSessions(now, s.cfg.Schedule.Windows, 8)
	st := Status{
		Mode:            s.getMode().String(),
		ServerRunning:   s.srv.IsRunning(),
		ServerTimeLocal: now.Format("2006-01-02 15:04:05"),
	}
	if cur := currentSession(now, sessions); cur != nil {
		st.InOpenWindow = true
		st.CurrentLabel = cur.Label
		st.CurrentCloseAt = cur.Close.Format("2006-01-02 15:04")
	}
	if nx := nextSession(now, sessions); nx != nil {
		st.NextOpenLabel = nx.Label
		st.NextOpenAt = nx.Open.Format("2006-01-02 15:04")
	}
	return st
}

func (s *Scheduler) getMode() Mode {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mode
}

func (s *Scheduler) consumeStopCountdown() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	cd := s.stopCountdown
	if cd <= 0 {
		cd = s.cfg.Runtime.ManualStopCountdown
	}
	if cd <= 0 {
		cd = 10
	}
	return cd
}

func (s *Scheduler) setOpenedKey(k string) {
	s.mu.Lock()
	s.openedKey = k
	s.mu.Unlock()
}

func (s *Scheduler) getOpenedKey() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.openedKey
}

func (s *Scheduler) signalWake() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// ---- 主迴圈 ----

// Run 進入主迴圈，直到 stop 關閉。
func (s *Scheduler) Run(stop <-chan struct{}) {
	now := s.now()
	log.Printf("排程器啟動。時區：%s（現在 %s）", s.loc, now.Format("2006-01-02 15:04:05 -07:00"))
	log.Println("開放時段：")
	for _, w := range s.cfg.Schedule.Windows {
		log.Printf("  - [%s] %v %s ~ %s", w.Label, w.Days, w.Open, w.Close)
	}
	for {
		if s.step(stop) {
			return
		}
	}
}

// step 依目前模式執行一個工作單元，並自行睡眠；回傳 true 表示收到終止訊號。
func (s *Scheduler) step(stop <-chan struct{}) bool {
	now := s.now()
	switch s.getMode() {
	case ModeForceOff:
		if s.srv.IsRunning() {
			if s.runManualStop(stop) {
				return true
			}
		}
		s.setOpenedKey("")
		return s.sleepOrStop(time.Hour, stop) // 靜候 API 喚醒

	case ModeForceOn:
		s.ensureStarted()
		return s.sleepOrStop(s.healthInterval(), stop) // 定期檢查、崩潰自動重啟

	default: // ModeAuto
		sessions := BuildSessions(now, s.cfg.Schedule.Windows, 8)
		active := currentSession(now, sessions)
		if active == nil {
			if s.srv.IsRunning() {
				log.Println("非開放時段偵測到容器在執行（AUTO）→ 停止")
				s.srv.Stop()
			}
			s.setOpenedKey("")
			return s.sleepOrStop(s.sleepUntilNext(now, sessions), stop)
		}
		return s.runAutoSession(*active, stop)
	}
}

// runAutoSession 處理一個 AUTO 時段：OnOpen → 監控/崩潰重啟 → OnClose（對齊 close） → 收尾。
// 回傳 true 表示收到終止訊號。
func (s *Scheduler) runAutoSession(sess Session, stop <-chan struct{}) bool {
	// 1) 開服流程（每個時段僅一次）
	if s.getOpenedKey() != sess.key() {
		log.Printf("=== 進入時段 [%s] %s ~ %s ===", sess.Label,
			sess.Open.Format("15:04"), sess.Close.Format("2006-01-02 15:04"))
		if s.runSteps(s.cfg.Hooks.OnOpen, stop, s.abortIfNotAuto) {
			return true
		}
		s.setOpenedKey(sess.key())
	}

	// 2) 等到「關服流程起始時間」= close - OnClose 總時長，其間監控崩潰
	lead := onCloseLead(s.cfg.Hooks.OnClose)
	closeStart := sess.Close.Add(-lead)
	health := s.healthInterval()
	for {
		if s.getMode() != ModeAuto {
			return false // 模式被 API 改變，交回外層處理
		}
		now := s.now()
		if !now.Before(closeStart) {
			break
		}
		if !s.srv.IsRunning() {
			log.Println("偵測到容器不在執行（可能崩潰）→ 重新啟動")
			s.ensureStarted()
		}
		wake := now.Add(health)
		if closeStart.Before(wake) {
			wake = closeStart
		}
		if s.sleepOrStop(time.Until(wake), stop) {
			return true
		}
	}

	// 3) 關服流程
	if s.getMode() != ModeAuto {
		return false
	}
	log.Printf("=== 時段 [%s] 關服流程開始 ===", sess.Label)
	if s.runSteps(s.cfg.Hooks.OnClose, stop, s.abortIfNotAuto) {
		return true
	}

	// 4) 收尾保險：close + grace 後確認容器已停
	if s.sleepOrStop(time.Until(sess.Close.Add(s.killGrace())), stop) {
		return true
	}
	if s.srv.IsRunning() {
		log.Println("關服流程後容器仍在 → 強制停止容器")
		s.srv.Stop()
	}
	s.setOpenedKey("")
	log.Printf("=== 時段 [%s] 結束 ===", sess.Label)
	return false
}

// runManualStop 執行 OnManualStop 流程（若未設定則用內建預設）。
func (s *Scheduler) runManualStop(stop <-chan struct{}) bool {
	steps := s.cfg.Hooks.OnManualStop
	cd := s.consumeStopCountdown()
	if len(steps) == 0 {
		steps = defaultManualStop(cd)
	} else {
		steps = overrideCountdown(steps, cd) // 用 API 指定的倒數秒數覆寫 countdown 步驟
	}
	log.Printf("=== 手動關服流程開始（倒數 %d 秒）===", cd)
	// 手動關服不因模式再變化而中止（已是 FORCE_OFF），只在收到 stop 訊號時中止。
	if s.runSteps(steps, stop, nil) {
		return true
	}
	if s.sleepOrStop(s.killGrace(), stop) {
		return true
	}
	if s.srv.IsRunning() {
		log.Println("手動關服後容器仍在 → 強制停止容器")
		s.srv.Stop()
	}
	log.Println("=== 手動關服流程結束 ===")
	return false
}

// ---- Step 執行引擎 ----

// runSteps 依序執行流程步驟。abort 若非 nil 且回傳 true，會中止剩餘步驟。
// 回傳 true 表示收到 stop 終止訊號。
func (s *Scheduler) runSteps(steps []config.Step, stop <-chan struct{}, abort func() bool) bool {
	for _, st := range steps {
		if abort != nil && abort() {
			log.Println("流程中止（模式已變更）")
			return false
		}
		switch normalizeType(st.Type) {
		case "startcontainer":
			s.ensureStarted()
		case "stopcontainer":
			s.srv.Stop()
		case "broadcast":
			s.broadcast(st.Message)
		case "wait":
			if s.waitSeconds(st.Seconds, stop, abort) {
				return true
			}
		case "countdown":
			if s.runCountdown(st, stop, abort) {
				return true
			}
		case "save":
			s.rconLog("Save")
		case "doexit":
			s.rconLog("DoExit")
		case "shutdown":
			s.rconLog(fmt.Sprintf("Shutdown %d %s", st.Seconds, st.Message))
		case "rcon":
			if st.Command != "" {
				s.rconLog(st.Command)
			}
		case "info":
			s.rconLog("Info")
		case "showplayers":
			s.rconLog("ShowPlayers")
		default:
			log.Printf("[流程] 略過未知步驟型別: %q", st.Type)
		}
	}
	return false
}

// runCountdown 執行倒數廣播。支援宣告式（announce 陣列 + tickFromSeconds）與
// 相容舊式（fromSeconds + prefix）。每秒檢查一次，遇到「廣播點」就送出訊息。
func (s *Scheduler) runCountdown(st config.Step, stop <-chan struct{}, abort func() bool) bool {
	marks := countdownMarks(st)
	total := countdownDuration(st)
	if total <= 0 {
		return false
	}
	for n := total; n >= 1; n-- {
		if abort != nil && abort() {
			return false
		}
		if msg, ok := marks[n]; ok {
			s.broadcast(msg)
		}
		if s.sleepOrStop(time.Second, stop) {
			return true
		}
	}
	// 倒數到 0：再廣播一則收尾訊息（若有設定）
	if st.TickEndMessage != "" {
		s.broadcast(st.TickEndMessage)
	}
	return false
}

// countdownMarks 建出「剩餘秒數 → 廣播訊息」對照表。
func countdownMarks(st config.Step) map[int]string {
	marks := make(map[int]string)
	// 1) 宣告式廣播點
	for _, a := range st.Announce {
		if a.At >= 1 && a.Message != "" {
			marks[a.At] = a.Message
		}
	}
	// 2) 尾段逐秒倒數
	tickFrom := st.TickFromSeconds
	tickPrefix := st.TickPrefix
	// 相容舊式：只有 fromSeconds+prefix 時，視為逐秒 tick
	if len(st.Announce) == 0 && tickFrom == 0 && st.FromSeconds > 0 {
		tickFrom = st.FromSeconds
		if tickPrefix == "" {
			tickPrefix = st.Prefix
		}
	}
	if tickFrom > 0 && tickPrefix == "" {
		tickPrefix = "Server closing in"
	}
	for n := 1; n <= tickFrom; n++ {
		marks[n] = fmt.Sprintf("%s %d", tickPrefix, n) // tick 覆蓋尾段的 announce
	}
	return marks
}

// countdownDuration 回傳整段倒數的總長（秒）= announce 最大 at 與 fromSeconds/tickFromSeconds 取最大。
func countdownDuration(st config.Step) int {
	d := st.FromSeconds
	if st.TickFromSeconds > d {
		d = st.TickFromSeconds
	}
	for _, a := range st.Announce {
		if a.At > d {
			d = a.At
		}
	}
	return d
}

// broadcast 送出一則全服廣播。優先用官方 REST announce（支援空白、且不受
// RCON 中文封包 bug 影響）；REST 未啟用或失敗時退回 RCON Broadcast。
func (s *Scheduler) broadcast(msg string) {
	if s.rest != nil {
		text := strings.ReplaceAll(msg, "_", " ") // REST 支援空白，底線視為空白更自然
		ctx, cancel := context.WithTimeout(context.Background(), restTimeout)
		defer cancel()
		if err := s.rest.Announce(ctx, text); err != nil {
			log.Printf("[REST 廣播失敗] %q → %v（退回 RCON）", text, err)
			s.rconLog("Broadcast " + strings.ReplaceAll(msg, " ", "_"))
			return
		}
		log.Printf("[REST 廣播] %s", text)
		return
	}
	s.rconLog("Broadcast " + strings.ReplaceAll(msg, " ", "_"))
}

// waitSeconds 以 1 秒為單位等待，期間可被 stop 中斷；abort 觸發則提早返回。
func (s *Scheduler) waitSeconds(seconds int, stop <-chan struct{}, abort func() bool) bool {
	for i := 0; i < seconds; i++ {
		if abort != nil && abort() {
			return false
		}
		if s.sleepOrStop(time.Second, stop) {
			return true
		}
	}
	return false
}

func (s *Scheduler) abortIfNotAuto() bool { return s.getMode() != ModeAuto }

func (s *Scheduler) ensureStarted() {
	if s.srv.IsRunning() {
		return
	}
	log.Println("啟動 Palworld 容器...")
	if err := s.srv.Start(); err != nil {
		log.Printf("啟動失敗: %v", err)
	}
}

// rconLog 送出一條 RCON 指令並記錄結果。
func (s *Scheduler) rconLog(command string) {
	resp, err := rcon.Send(s.cfg.RCON.Host, s.cfg.RCON.Port, s.cfg.RCON.Password, command, rconTimeout)
	if err != nil {
		log.Printf("[RCON 失敗] %s → %v", command, err)
		return
	}
	log.Printf("[RCON] %s%s", command, trimResp(resp))
}

func (s *Scheduler) healthInterval() time.Duration {
	if s.cfg.Runtime.HealthCheckSeconds > 0 {
		return time.Duration(s.cfg.Runtime.HealthCheckSeconds) * time.Second
	}
	return 30 * time.Second
}

func (s *Scheduler) killGrace() time.Duration {
	return time.Duration(s.cfg.Runtime.KillGraceSeconds) * time.Second
}

func (s *Scheduler) sleepUntilNext(now time.Time, sessions []Session) time.Duration {
	if nx := nextSession(now, sessions); nx != nil {
		return clampSleep(time.Until(nx.Open))
	}
	return time.Hour
}

// onCloseLead 計算關服流程的總時長（wait + countdown），用以決定何時開始執行。
func onCloseLead(steps []config.Step) time.Duration {
	total := 0
	for _, st := range steps {
		switch normalizeType(st.Type) {
		case "wait":
			total += st.Seconds
		case "countdown":
			total += countdownDuration(st)
		}
	}
	return time.Duration(total) * time.Second
}

// defaultManualStop 在未設定 OnManualStop 時使用的內建流程。
func defaultManualStop(countdown int) []config.Step {
	return []config.Step{
		{Type: "countdown", FromSeconds: countdown, Prefix: "Server_closing_in"},
		{Type: "save"},
		{Type: "doexit"},
		{Type: "wait", Seconds: 10},
		{Type: "stopContainer"},
	}
}

// overrideCountdown 把流程中 countdown 步驟的 fromSeconds 換成指定值（cd>0 時）。
func overrideCountdown(steps []config.Step, cd int) []config.Step {
	if cd <= 0 {
		return steps
	}
	out := make([]config.Step, len(steps))
	copy(out, steps)
	for i := range out {
		if normalizeType(out[i].Type) == "countdown" {
			out[i].FromSeconds = cd
		}
	}
	return out
}

// ---- 時段計算 ----

// BuildSessions 產生 now 起 daysAhead 天內、依 windows 展開的所有具體時段，依開服時間排序。
func BuildSessions(now time.Time, windows []config.Window, daysAhead int) []Session {
	var out []Session
	loc := now.Location()
	// 從「前一天」開始，才能涵蓋昨天開始、跨午夜延續到現在的時段（例如 20:00~03:00）。
	for d := -1; d <= daysAhead; d++ {
		day := now.AddDate(0, 0, d)
		for _, w := range windows {
			if !matchesWeekday(w.Days, day.Weekday()) {
				continue
			}
			oh, om, _ := config.ParseHM(w.Open)
			ch, cm, _ := config.ParseHM(w.Close)
			open := time.Date(day.Year(), day.Month(), day.Day(), oh, om, 0, 0, loc)
			closeT := time.Date(day.Year(), day.Month(), day.Day(), ch, cm, 0, 0, loc)
			if !closeT.After(open) {
				closeT = closeT.AddDate(0, 0, 1)
			}
			out = append(out, Session{Label: w.Label, Open: open, Close: closeT})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Open.Before(out[j].Open) })
	return out
}

func currentSession(now time.Time, sessions []Session) *Session {
	for i := range sessions {
		if !sessions[i].Open.After(now) && sessions[i].Close.After(now) {
			return &sessions[i]
		}
	}
	return nil
}

func nextSession(now time.Time, sessions []Session) *Session {
	for i := range sessions {
		if sessions[i].Open.After(now) {
			return &sessions[i]
		}
	}
	return nil
}

func matchesWeekday(days []string, wd time.Weekday) bool {
	for _, d := range days {
		if pw, err := config.ParseWeekday(d); err == nil && pw == wd {
			return true
		}
	}
	return false
}

// ---- 小工具 ----

func normalizeType(t string) string {
	out := make([]byte, 0, len(t))
	for i := 0; i < len(t); i++ {
		c := t[i]
		if c == '_' || c == '-' || c == ' ' {
			continue
		}
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out = append(out, c)
	}
	return string(out)
}

func clampSleep(d time.Duration) time.Duration {
	if d < time.Second {
		return time.Second
	}
	if d > time.Hour {
		return time.Hour
	}
	return d
}

// sleepOrStop 睡指定時間；收到 stop 回傳 true，收到 wake（API 變更）則提早返回 false。
func (s *Scheduler) sleepOrStop(d time.Duration, stop <-chan struct{}) bool {
	if d <= 0 {
		select {
		case <-stop:
			return true
		default:
			return false
		}
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-stop:
		return true
	case <-s.wake:
		return false
	case <-t.C:
		return false
	}
}

func trimResp(resp string) string {
	if resp == "" {
		return ""
	}
	return " -> " + resp
}
