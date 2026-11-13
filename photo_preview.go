package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"makeupmirror/internal/facemesh"
	"makeupmirror/internal/photo"
	"makeupmirror/internal/project"
)

const photoPreviewPrefix = "/local-photo-preview/"

type previewAsset struct {
	id, format string
	data       []byte
	mesh       *facemesh.Result
}

// PhotoPreviewService serializes user-initiated photo and project actions.
type PhotoPreviewService struct {
	pick        func() (string, error)
	pickProject func() (string, error)
	pickExport  func() (string, error)
	workspace   *project.Store
	busy        atomic.Bool
	mu          sync.RWMutex
	current     previewAsset
	generated   previewAsset
}

type projectResult struct {
	Active      bool                 `json:"active"`
	URL         string               `json:"url,omitempty"`
	Message     string               `json:"message"`
	Draft       *project.Makeup      `json:"draft,omitempty"`
	Preferences *project.Preferences `json:"preferences,omitempty"`
}

type projectAction struct {
	Done    bool   `json:"done"`
	Message string `json:"message"`
}

func nativeProjectPicker(window application.Window) func() (string, error) {
	return func() (string, error) {
		return application.Get().Dialog.OpenFile().AttachToWindow(window).
			CanChooseFiles(false).CanChooseDirectories(true).
			SetTitle("选择本机项目目录").PromptForSingleSelection()
	}
}

func nativeExportPicker(window application.Window) func() (string, error) {
	return func() (string, error) {
		return application.Get().Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
			Title: "导出预览为 PNG", Filename: "makeup-preview.png", Window: window,
			Filters: []application.FileFilter{{DisplayName: "PNG 图像", Pattern: "*.png"}},
		}).PromptForSingleSelection()
	}
}

func (s *PhotoPreviewService) ExportPreview(encoded string) string {
	if !s.busy.CompareAndSwap(false, true) {
		return "正在处理，请稍候。"
	}
	defer s.busy.Store(false)
	s.mu.RLock()
	hasPhoto := s.current.id != ""
	s.mu.RUnlock()
	if !hasPhoto {
		return "请选择照片后再导出。"
	}
	path, err := s.pickExport()
	if err != nil || path == "" {
		return "未导出预览。"
	}
	if err := project.ExportPNG(path, encoded); err != nil {
		return err.Error()
	}
	return "预览已导出。"
}

func (s *PhotoPreviewService) CreateProject() projectResult { return s.selectProject(true) }
func (s *PhotoPreviewService) OpenProject() projectResult   { return s.selectProject(false) }

func (s *PhotoPreviewService) selectProject(create bool) projectResult {
	if !s.busy.CompareAndSwap(false, true) {
		return projectResult{Message: "正在处理，请稍候。"}
	}
	defer s.busy.Store(false)
	if s.workspace != nil {
		return projectResult{Message: "请先关闭当前项目。"}
	}
	path, err := s.pickProject()
	if err != nil || path == "" {
		return projectResult{Message: "未选择项目目录。"}
	}
	if create {
		store, err := project.Create(path)
		if err != nil {
			return projectResult{Message: err.Error()}
		}
		s.workspace = store
		return projectResult{Active: true, Message: "项目已新建。"}
	}
	store, saved, err := project.Open(path)
	if err != nil {
		return projectResult{Message: err.Error()}
	}
	s.workspace = store
	result := projectResult{Active: true, Draft: saved.Draft, Preferences: saved.Preferences, Message: "项目已打开。"}
	s.setAsset(previewAsset{})
	if saved.Photo != nil {
		asset := previewAsset{id: rand.Text(), format: saved.Photo.Format, data: saved.Photo.Bytes, mesh: saved.Draft.Mesh}
		s.setAsset(asset)
		result.URL = photoPreviewPrefix + asset.id
	}
	return result
}

func (s *PhotoPreviewService) SaveProject(draft project.Draft) projectAction {
	if !s.busy.CompareAndSwap(false, true) {
		return projectAction{Message: "正在处理，请稍候。"}
	}
	defer s.busy.Store(false)
	if s.workspace == nil {
		return projectAction{Message: "请先新建或打开项目。"}
	}
	s.mu.RLock()
	asset := s.current
	s.mu.RUnlock()
	if asset.id == "" {
		return projectAction{Message: "请选择照片后再保存。"}
	}
	// Only a result associated with this exact photo by the backend is saved.
	draft.Mesh = nil
	draft.PhotoSHA256 = ""
	if draft.Analyzed && asset.mesh != nil {
		draft.Mesh = asset.mesh
		digest := sha256.Sum256(asset.data)
		draft.PhotoSHA256 = hex.EncodeToString(digest[:])
	}
	snapshot := project.Snapshot{Draft: &draft.Makeup, Preferences: &draft.Preferences, Photo: &project.Photo{Format: asset.format, Bytes: asset.data}}
	if err := s.workspace.Save(snapshot); err != nil {
		return projectAction{Message: err.Error()}
	}
	return projectAction{Done: true, Message: "项目已保存。"}
}

func (s *PhotoPreviewService) RemoveProjectPhoto() projectAction {
	if !s.busy.CompareAndSwap(false, true) {
		return projectAction{Message: "正在处理，请稍候。"}
	}
	defer s.busy.Store(false)
	if s.workspace == nil {
		return projectAction{Message: "请先打开项目。"}
	}
	if err := s.workspace.RemovePhoto(); err != nil {
		return projectAction{Message: err.Error()}
	}
	s.setAsset(previewAsset{})
	return projectAction{Done: true, Message: "项目照片和妆容已移除。"}
}

func (s *PhotoPreviewService) CloseProject() bool {
	if !s.busy.CompareAndSwap(false, true) {
		return false
	}
	defer s.busy.Store(false)
	if s.workspace == nil {
		return false
	}
	s.workspace.Close()
	s.workspace = nil
	s.setAsset(previewAsset{})
	return true
}

func (s *PhotoPreviewService) setAsset(asset previewAsset) {
	s.mu.Lock()
	s.current = asset
	s.generated = previewAsset{}
	s.mu.Unlock()
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
	asset := previewAsset{id: rand.Text(), format: info.Format, data: data}
	s.setAsset(asset)
	return pickResult{URL: photoPreviewPrefix + asset.id}
}

func (s *PhotoPreviewService) Clear() bool {
	if !s.busy.CompareAndSwap(false, true) {
		return false
	}
	defer s.busy.Store(false)
	s.setAsset(previewAsset{})
	return true
}

func (s *PhotoPreviewService) assets(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, matched := strings.CutPrefix(r.URL.Path, photoPreviewPrefix)
		generated := false
		if !matched {
			id, generated = strings.CutPrefix(r.URL.Path, generatedPreviewPrefix)
			matched = generated
		}
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
		if generated {
			asset = s.generated
		}
		s.mu.RUnlock()
		if id == "" || id != asset.id {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/"+asset.format)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = w.Write(asset.data)
		}
	})
}
