package main

import "makeupmirror/internal/provider"

type ImageService struct {
	store *provider.Store
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
