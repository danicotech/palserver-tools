//go:build windows

package palsave

import (
	"os/exec"
	"syscall"
)

// hideWindow 讓 python 子行程不要自己彈一個主控台視窗出來。
// 這裡不能用 DETACHED_PROCESS（procctl 對 PalServer 用的那個）——
// 那會切斷 stdout，就讀不到 palsave 的訊息、也沒辦法印進排程器視窗。
// CREATE_NO_WINDOW 才是「保留管線但不要視窗」。
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
