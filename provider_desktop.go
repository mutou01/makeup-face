package main

import "makeupmirror/internal/provider"

type ProviderService struct {
	store *provider.Store
}

func (s *ProviderService) GetSettings() (provider.View, error) { return s.store.View() }
func (s *ProviderService) SaveSettings(input provider.Input) (provider.View, error) {
	return s.store.Save(input)
}
func (s *ProviderService) ForgetKey() (provider.View, error) { return s.store.ForgetKey() }
