//go:build !desktop_smoke

package main

import (
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"makeupmirror/internal/provider"
)

func desktopProviderStore() *provider.Store {
	directory, err := os.UserCacheDir()
	if err != nil {
		return provider.NewStore("", provider.WindowsVault{})
	}
	return provider.NewStore(filepath.Join(directory, "MakeupMirror"), provider.WindowsVault{})
}

func desktopOptions() application.WindowsOptions {
	return application.WindowsOptions{}
}

func desktopPhotoPicker(window application.Window) func() (string, error) {
	return nativePhotoPicker(window)
}

func desktopProjectPicker(window application.Window) func() (string, error) {
	return nativeProjectPicker(window)
}

func desktopExportPicker(window application.Window) func() (string, error) {
	return nativeExportPicker(window)
}

func desktopFaceRuntime() (string, bool) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", false
	}
	return filepath.Join(cache, "MakeupMirror", "face-runtime", "v1"), false
}
