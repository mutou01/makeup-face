package main

import (
	"context"
	"crypto/rand"
	"errors"
	"net/http"

	"makeupmirror/internal/project"
	"makeupmirror/internal/provider"
)

const generatedPreviewPrefix = "/local-image-preview/"

type ImageService struct {
	store   *provider.Store
	client  *http.Client
	preview *PhotoPreviewService
}

func (s *ImageService) GetSettings() (provider.View, error) {
	return s.store.View()
}

func (s *ImageService) SaveSettings(endpoint, model, key string) (provider.View, error) {
	return s.store.Save(provider.Input{Enabled: true, Endpoint: endpoint, Model: model, Key: key})
}

func (s *ImageService) ForgetKey() (provider.View, error) {
	return s.store.ForgetKey()
}

func (s *ImageService) Generate(ctx context.Context, photoURL, endpoint, model, preset, frame string) (string, error) {
	if !s.preview.busy.CompareAndSwap(false, true) {
		return "", errors.New("正在处理照片，请稍候。")
	}
	defer s.preview.busy.Store(false)
	s.preview.mu.RLock()
	id := s.preview.current.id
	s.preview.mu.RUnlock()
	if id == "" || photoURL != photoPreviewPrefix+id {
		return "", errors.New("当前照片已变化，请重新确认发送。")
	}
	data, err := s.store.EditImage(ctx, s.client, endpoint, model, preset, frame)
	if err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", errors.New("本次生成已取消。")
	}
	asset := previewAsset{id: rand.Text(), format: "png", data: data}
	s.preview.mu.Lock()
	s.preview.generated = asset
	s.preview.mu.Unlock()
	return generatedPreviewPrefix + asset.id, nil
}

func (s *ImageService) ExportGenerated(resultURL string) string {
	if !s.preview.busy.CompareAndSwap(false, true) {
		return "正在处理照片，请稍候。"
	}
	defer s.preview.busy.Store(false)
	s.preview.mu.RLock()
	asset := s.preview.generated
	s.preview.mu.RUnlock()
	if asset.id == "" || resultURL != generatedPreviewPrefix+asset.id {
		return "没有可导出的生图结果。"
	}
	path, err := s.preview.pickExport()
	if err != nil || path == "" {
		return "未导出生图。"
	}
	if err := project.WritePNG(path, asset.data); err != nil {
		return err.Error()
	}
	return "生图已导出。"
}
