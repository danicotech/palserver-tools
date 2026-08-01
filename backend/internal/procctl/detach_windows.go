//go:build windows

package procctl

import (
	"os/exec"
	"syscall"
)

// detach 讓伺服器獨立於排程器的 console:排程器關掉時不會被一起帶走,
// 也不會在使用者畫面上再開一個黑視窗。
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008, // DETACHED_PROCESS
	}
}
