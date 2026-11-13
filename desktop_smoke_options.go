//go:build desktop_smoke

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/wailsapp/wails/v3/pkg/application"
	"makeupmirror/internal/provider"
)

type memoryVault map[string][]byte

func (v memoryVault) Read(target string) ([]byte, error) {
	return append([]byte(nil), v[target]...), nil
}
func (v memoryVault) Write(target string, key []byte) error {
	v[target] = append([]byte(nil), key...)
	return nil
}
func (v memoryVault) Delete(target string) error { clear(v[target]); delete(v, target); return nil }

func desktopProviderStore() *provider.Store {
	return provider.NewStore(os.Getenv("MAKEUPMIRROR_SMOKE_PROFILE"), memoryVault{})
}

func desktopFaceStore() *provider.Store {
	return provider.NewFaceStore(os.Getenv("MAKEUPMIRROR_SMOKE_PROFILE"), memoryVault{})
}

func desktopImageStore() *provider.Store {
	return provider.NewImageStore(os.Getenv("MAKEUPMIRROR_SMOKE_PROFILE"), memoryVault{})
}

type fixtureTransport struct{ address string }

func (transport fixtureTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	host, port, err := net.SplitHostPort(transport.address)
	if err != nil || host != "127.0.0.1" || port == "" || req.URL.Scheme != "https" || req.URL.Host != "fixture.test" {
		return nil, errors.New("只允许访问验收用本机供应商")
	}
	copy := req.Clone(req.Context())
	copy.URL.Scheme = "http"
	copy.URL.Host = transport.address
	return (&http.Transport{DisableKeepAlives: true}).RoundTrip(copy)
}

func desktopProviderClient() *http.Client {
	return &http.Client{Transport: fixtureTransport{address: os.Getenv("MAKEUPMIRROR_SMOKE_PROVIDER_ADDR")}}
}

func desktopFaceFixture() (application.Middleware, bool) {
	root := os.Getenv("MAKEUPMIRROR_SMOKE_FACE_DIR")
	if !filepath.IsAbs(root) {
		return func(next http.Handler) http.Handler { return next }, false
	}
	return faceRuntimeAssets(root, os.Getenv("MAKEUPMIRROR_SMOKE_FACE_FIXTURE") == "1"), true
}

func desktopPhotoPicker(window application.Window) func() (string, error) {
	return smokePicker("MAKEUPMIRROR_SMOKE_PHOTO_SELECTIONS", nativePhotoPicker(window))
}

func desktopProjectPicker(window application.Window) func() (string, error) {
	return smokePicker("MAKEUPMIRROR_SMOKE_PROJECT_DIRS", nativeProjectPicker(window))
}

func desktopExportPicker(window application.Window) func() (string, error) {
	return smokePicker("MAKEUPMIRROR_SMOKE_EXPORT_PATHS", nativeExportPicker(window))
}

func smokePicker(key string, fallback func() (string, error)) func() (string, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	var selections []string
	if err := json.Unmarshal([]byte(raw), &selections); err != nil {
		log.Fatal("桌面验收选择列表无效")
	}
	return func() (string, error) {
		if len(selections) == 0 {
			return "", nil
		}
		selected := selections[0]
		selections = selections[1:]
		return selected, nil
	}
}

func desktopOptions() application.WindowsOptions {
	port, err := strconv.ParseUint(os.Getenv("MAKEUPMIRROR_SMOKE_PORT"), 10, 16)
	profile := os.Getenv("MAKEUPMIRROR_SMOKE_PROFILE")
	if err != nil || port == 0 || profile == "" {
		log.Fatal("桌面验收必须设置有效的调试端口和临时 WebView2 配置目录")
	}
	return application.WindowsOptions{
		WebviewUserDataPath: profile,
		AdditionalBrowserArgs: []string{
			"--remote-debugging-address=127.0.0.1",
			fmt.Sprintf("--remote-debugging-port=%d", port),
		},
	}
}
