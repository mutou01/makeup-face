package provider

import (
	"errors"

	"github.com/danieljoos/wincred"
)

type WindowsVault struct{}

func (WindowsVault) Read(target string) ([]byte, error) {
	credential, err := wincred.GetGenericCredential(target)
	if errors.Is(err, wincred.ErrElementNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return credential.CredentialBlob, nil
}

func (WindowsVault) Write(target string, key []byte) error {
	credential := wincred.NewGenericCredential(target)
	credential.Persist = wincred.PersistLocalMachine
	credential.CredentialBlob = key
	return credential.Write()
}

func (WindowsVault) Delete(target string) error {
	err := wincred.NewGenericCredential(target).Delete()
	if errors.Is(err, wincred.ErrElementNotFound) {
		return nil
	}
	return err
}
