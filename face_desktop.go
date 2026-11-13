package main

import (
	"context"
	"errors"
	"net/http"

	"makeupmirror/internal/facemesh"
	"makeupmirror/internal/provider"
)

type FaceService struct {
	store   *provider.Store
	client  *http.Client
	preview *PhotoPreviewService
	fixture bool
}

type faceView struct {
	provider.View
	Fixture bool `json:"fixture"`
}

func (s *FaceService) GetSettings() (faceView, error) {
	view, err := s.store.View()
	return faceView{View: view, Fixture: s.fixture}, err
}

func (s *FaceService) SaveSettings(endpoint, key string) (provider.View, error) {
	if endpoint == "" {
		return provider.View{}, errors.New("请填写人脸网格 HTTPS 接口。")
	}
	return s.store.Save(provider.Input{Enabled: true, Endpoint: endpoint, Model: facemesh.Topology, Key: key})
}

func (s *FaceService) ForgetKey() (provider.View, error) {
	return s.store.ForgetKey()
}

func (s *FaceService) Analyze(ctx context.Context, photoURL, endpoint, image string) (facemesh.Result, error) {
	if !s.preview.busy.CompareAndSwap(false, true) {
		return facemesh.Result{}, errors.New("正在处理照片，请稍候。")
	}
	defer s.preview.busy.Store(false)
	s.preview.mu.RLock()
	id := s.preview.current.id
	s.preview.mu.RUnlock()
	if id == "" || photoURL != photoPreviewPrefix+id {
		return facemesh.Result{}, errors.New("当前照片已变化，请重新确认发送。")
	}
	result, err := s.store.AnalyzeFace(ctx, s.client, endpoint, image)
	if err == nil && len(result.Faces) == 1 {
		s.preview.mu.Lock()
		s.preview.current.mesh = &result
		s.preview.mu.Unlock()
	}
	return result, err
}
