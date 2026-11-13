package provider

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
)

func hideCodexWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

func findCodexExecutable() (string, error) {
	path, err := exec.LookPath("codex.exe")
	if err == nil {
		return path, nil
	}
	// npm adds a .cmd launcher to PATH, but the OpenAI package also contains
	// a native executable. Start that directly, without invoking a shell.
	arch, triple := "x64", "x86_64-pc-windows-msvc"
	if runtime.GOARCH == "arm64" {
		arch, triple = "arm64", "aarch64-pc-windows-msvc"
	}
	var roots []string
	if shim, err := exec.LookPath("codex.cmd"); err == nil {
		roots = append(roots, filepath.Dir(shim))
	}
	if appdata := os.Getenv("APPDATA"); filepath.IsAbs(appdata) {
		roots = append(roots, filepath.Join(appdata, "npm"))
	}
	for _, root := range roots {
		modules := filepath.Join(root, "node_modules")
		packageName := "codex-win32-" + arch
		for _, base := range []string{filepath.Join(modules, "@openai", "codex", "node_modules"), modules} {
			candidate := filepath.Join(base, "@openai", packageName, "vendor", triple, "bin", "codex.exe")
			if info, e := os.Stat(candidate); e == nil && info.Mode().IsRegular() {
				return candidate, nil
			}
		}
	}
	return "", err
}
