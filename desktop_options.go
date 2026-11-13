//go:build !desktop_smoke

package main

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"makeupmirror/internal/provider"
)

func desktopProviderClient() *http.Client { return provider.NewHTTPClient() }

func desktopProviderStore() *provider.Store {
	directory, err := os.UserCacheDir()
	if err != nil {
		return provider.NewStore("", provider.WindowsVault{})
	}
	return provider.NewStore(filepath.Join(directory, "MakeupMirror"), provider.WindowsVault{})
}

func desktopFaceStore() *provider.Store {
	directory, err := os.UserCacheDir()
	if err != nil {
		return provider.NewFaceStore("", provider.WindowsVault{})
	}
	return provider.NewFaceStore(filepath.Join(directory, "MakeupMirror"), provider.WindowsVault{})
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

func desktopFaceFixture() (application.Middleware, bool) {
	return func(next http.Handler) http.Handler { return next }, false
}
