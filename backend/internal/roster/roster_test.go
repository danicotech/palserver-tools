package roster

import (
	"path/filepath"
	"testing"
)

func TestSetGetAndPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "roster.json")
	s := New(path)

	// 空值不接受
	if _, ok := s.Set("", "SheepBall"); ok {
		t.Fatal("空名稱不應成功")
	}
	if _, ok := s.Set("Alice", ""); ok {
		t.Fatal("空 palId 不應成功")
	}

	s.Set("Alice", "SheepBall")
	s.Set("Bob", "CowPal")
	// 同名（大小寫/空白不同）應覆蓋，而非新增
	s.Set("  alice ", "Anubis")

	got := s.Get()
	if len(got) != 2 {
		t.Fatalf("應有 2 位玩家，實得 %d", len(got))
	}
	byName := map[string]string{}
	for _, e := range got {
		byName[e.Name] = e.PalID
	}
	if byName["alice"] != "Anubis" { // 名稱經 TrimSpace 後儲存
		t.Fatalf("Alice 頭像應被覆蓋為 Anubis，實得 %q", byName["alice"])
	}
	if byName["Bob"] != "CowPal" {
		t.Fatalf("Bob 頭像錯誤: %q", byName["Bob"])
	}

	// 重新載入應保留（持久化 + 原子寫入）
	s2 := New(path)
	if len(s2.Get()) != 2 {
		t.Fatalf("重新載入後應有 2 筆，實得 %d", len(s2.Get()))
	}
}
