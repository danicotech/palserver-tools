package scheduler

import (
	"testing"
	"time"

	"palscheduler/internal/config"
)

// 驗證真實 config.json 能載入，且關服流程總時長、時段計算正確。
func TestConfigAndSessionMath(t *testing.T) {
	cfg, err := config.Load("../../config.json")
	if err != nil {
		t.Fatalf("載入 config.json 失敗: %v", err)
	}

	// onCloseLead 應 = 各 wait 秒數 + countdown 總長（獨立算一次比對，避免綁死 config 具體數值）。
	want := time.Duration(0)
	for _, st := range cfg.Hooks.OnClose {
		switch normalizeType(st.Type) {
		case "wait":
			want += time.Duration(st.Seconds) * time.Second
		case "countdown":
			d := st.FromSeconds
			if st.TickFromSeconds > d {
				d = st.TickFromSeconds
			}
			for _, a := range st.Announce {
				if a.At > d {
					d = a.At
				}
			}
			want += time.Duration(d) * time.Second
		}
	}
	if got := onCloseLead(cfg.Hooks.OnClose); got != want {
		t.Fatalf("onCloseLead = %v, want %v", got, want)
	}
	if want <= 0 {
		t.Fatal("onCloseLead 應為正數（onClose 需含 countdown/wait）")
	}

	// 週一 09:00：morning(10-15) 尚未開始 → current 為 nil、next 為 10:00 開服
	mon := time.Date(2026, 7, 13, 9, 0, 0, 0, time.Local)
	ss := BuildSessions(mon, cfg.Schedule.Windows, 3)
	if currentSession(mon, ss) != nil {
		t.Fatal("09:00 不應在任何時段內")
	}
	nx := nextSession(mon, ss)
	if nx == nil || nx.Open.Hour() != 10 || nx.Label != "morning" {
		t.Fatalf("下一時段應為 morning 10:00，得到 %+v", nx)
	}

	// 跨午夜：evening 週一 20:00 開，close 應落在週二 03:00
	monEvening := time.Date(2026, 7, 13, 21, 0, 0, 0, time.Local)
	cur := currentSession(monEvening, BuildSessions(monEvening, cfg.Schedule.Windows, 3))
	if cur == nil || cur.Label != "evening" {
		t.Fatalf("21:00 應在 evening 時段內，得到 %+v", cur)
	}
	if cur.Close.Day() != 14 || cur.Close.Hour() != 3 {
		t.Fatalf("evening 關服應為 7/14 03:00，得到 %v", cur.Close)
	}
}

// 宣告式 countdown：announce 廣播點 + tickFromSeconds 逐秒尾段。
func TestCountdownDeclarative(t *testing.T) {
	st := config.Step{
		Announce: []config.Announce{
			{At: 1800, Message: "30m"},
			{At: 600, Message: "10m"},
			{At: 60, Message: "1m"},
		},
		TickFromSeconds: 3,
		TickPrefix:      "closing in",
	}
	if got := countdownDuration(st); got != 1800 {
		t.Fatalf("countdownDuration = %d, want 1800", got)
	}
	marks := countdownMarks(st)
	if marks[1800] != "30m" || marks[600] != "10m" || marks[60] != "1m" {
		t.Fatalf("announce 標記錯誤: %+v", marks)
	}
	for n, want := range map[int]string{1: "closing in 1", 2: "closing in 2", 3: "closing in 3"} {
		if marks[n] != want {
			t.Fatalf("tick[%d]=%q, want %q", n, marks[n], want)
		}
	}
	if _, ok := marks[59]; ok {
		t.Fatal("59 秒不應是廣播點")
	}
}

// 相容舊式 countdown：fromSeconds + prefix → 逐秒。
func TestCountdownLegacy(t *testing.T) {
	st := config.Step{FromSeconds: 2, Prefix: "closing"}
	if got := countdownDuration(st); got != 2 {
		t.Fatalf("countdownDuration = %d, want 2", got)
	}
	m := countdownMarks(st)
	if m[1] != "closing 1" || m[2] != "closing 2" {
		t.Fatalf("legacy marks 錯誤: %+v", m)
	}
}

func TestNormalizeType(t *testing.T) {
	cases := map[string]string{
		"startContainer": "startcontainer",
		"stop_container": "stopcontainer",
		"Show Players":   "showplayers",
		"DoExit":         "doexit",
	}
	for in, want := range cases {
		if got := normalizeType(in); got != want {
			t.Errorf("normalizeType(%q) = %q, want %q", in, got, want)
		}
	}
}
