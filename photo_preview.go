package main

import (
	"crypto/rand"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"makeupmirror/internal/photo"
)

const photoPreviewPrefix = "/local-photo-preview/"

type previewAsset struct {
	id, mime string
	data     []byte
}

// PhotoPreviewService only exposes user-initiated selection and clearing to the window.
type PhotoPreviewService struct {
	pick    func() (string, error)
	busy    atomic.Bool
	mu      sync.RWMutex
	current previewAsset
}

type pickResult struct {
	URL     string `json:"url,omitempty"`
	Message string `json:"message,omitempty"`
}

func nativePhotoPicker(window application.Window) func() (string, error) {
	return func() (string, error) {
		return application.Get().Dialog.OpenFile().
			AttachToWindow(window).
			CanChooseFiles(true).
			CanChooseDirectories(false).
			SetTitle("选择本机照片").
			AddFilter("JPEG、PNG 或 WebP", "*.jpg;*.jpeg;*.png;*.webp").
			PromptForSingleSelection()
	}
}

func (s *PhotoPreviewService) Pick() pickResult {
	if !s.busy.CompareAndSwap(false, true) {
		return pickResult{Message: "正在处理照片，请稍候。"}
	}
	defer s.busy.Store(false)
	path, err := s.pick()
	if err != nil || path == "" {
		// The Windows picker returns an error on cancellation and does not expose a public cancellation sentinel.
		return pickResult{Message: "未更换照片。"}
	}
	if !filepath.IsAbs(path) || strings.HasPrefix(path, `\\`) {
		return pickResult{Message: "请选择本机磁盘上的照片。"}
	}
	file, err := os.Open(path)
	if err != nil {
		return pickResult{Message: photo.ErrRead.Error()}
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() {
		return pickResult{Message: photo.ErrRead.Error()}
	}
	info, data, err := photo.Read(filepath.Base(path), file)
	if err != nil {
		return pickResult{Message: err.Error()}
	}
	asset := previewAsset{id: rand.Text(), mime: "image/" + info.Format, data: data}
	s.mu.Lock()
	s.current = asset
	s.mu.Unlock()
	return pickResult{URL: photoPreviewPrefix + asset.id}
}

func (s *PhotoPreviewService) Clear() bool {
	if !s.busy.CompareAndSwap(false, true) {
		return false
	}
	defer s.busy.Store(false)
	s.mu.Lock()
	s.current = previewAsset{}
	s.mu.Unlock()
	return true
}

func (s *PhotoPreviewService) assets(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, matched := strings.CutPrefix(r.URL.Path, photoPreviewPrefix)
		if !matched {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		s.mu.RLock()
		asset := s.current
		s.mu.RUnlock()
		if id == "" || id != asset.id {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", asset.mime)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = w.Write(asset.data)
		}
	})
}
