//go:build !desktop_smoke

package main

import (
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func desktopOptions() application.WindowsOptions {
	return application.WindowsOptions{}
}

func desktopPhotoPicker(window application.Window) func() (string, error) {
	return nativePhotoPicker(window)
}

func desktopProjectPicker(window application.Window) func() (string, error) {
	return nativeProjectPicker(window)
}

func desktopFaceRuntime() (string, bool) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", false
	}
	return filepath.Join(cache, "MakeupMirror", "face-runtime", "v1"), false
}
