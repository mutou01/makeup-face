package provider

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCodexFindsNativeNpmInstallOutsidePath(t *testing.T) {
	appdata, emptyPath := t.TempDir(), t.TempDir()
	t.Setenv("APPDATA", appdata)
	t.Setenv("PATH", emptyPath)
	if path, err := findCodexExecutable(); err == nil {
		t.Fatalf("unexpected executable before fixture: %s", path)
	}
	exe := filepath.Join(appdata, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe")
	if err := os.MkdirAll(filepath.Dir(exe), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := findCodexExecutable(); err != nil || got != exe {
		t.Fatalf("native npm Codex outside PATH: %q %v", got, err)
	}
}
