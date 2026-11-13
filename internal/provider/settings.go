package provider

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const configName = "provider.json"

var (
	errConfig          = errors.New("无法读取供应商设置，请检查本机设置文件。")
	errSave            = errors.New("无法保存供应商设置，请检查本机设置目录。")
	errEndpoint        = errors.New("仅支持 HTTPS 聊天补全接口，请填写不含凭据、查询参数和片段的完整地址。")
	errModel           = errors.New("请填写有效的模型编号。")
	errKey             = errors.New("请填写有效的供应商密钥。")
	errKeyRequired     = errors.New("启用 AI 解释前请填写供应商密钥。")
	errEndpointChanged = errors.New("更换接口须重新填写密钥。")
	errVault           = errors.New("无法访问 Windows 凭据管理器。")
	modelPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$`)
	credentialPattern  = regexp.MustCompile(`^[A-Z2-7]{26,64}$`)
	hostPattern        = regexp.MustCompile(`^[a-z0-9.-]+$`)
)

type Vault interface {
	Read(target string) ([]byte, error)
	Write(target string, key []byte) error
	Delete(target string) error
}

type Input struct {
	Enabled  bool   `json:"enabled"`
	Endpoint string `json:"endpoint"`
	Model    string `json:"model"`
	Key      string `json:"key"`
}

type View struct {
	Enabled  bool   `json:"enabled"`
	Endpoint string `json:"endpoint"`
	Model    string `json:"model"`
	HasKey   bool   `json:"hasKey"`
	Warning  string `json:"warning,omitempty"`
}

type config struct {
	Enabled      bool   `json:"enabled"`
	Endpoint     string `json:"endpoint"`
	Model        string `json:"model"`
	CredentialID string `json:"credentialId,omitempty"`
}

type Store struct {
	directory string
	vault     Vault
	mu        sync.Mutex
	name      string
	suffix    string
}

func NewStore(directory string, vault Vault) *Store {
	return &Store{directory: directory, vault: vault, name: configName, suffix: "/chat/completions"}
}

func NewImageStore(directory string, vault Vault) *Store {
	return &Store{directory: directory, vault: vault, name: "image-provider.json", suffix: "/images/edits"}
}

func (s *Store) View() (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.read()
	if err != nil {
		return View{}, err
	}
	return s.view(c), nil
}

func (s *Store) Save(in Input) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	old, err := s.read()
	if err != nil {
		return View{}, err
	}
	next := config{Enabled: in.Enabled, Endpoint: strings.TrimSpace(in.Endpoint), Model: strings.TrimSpace(in.Model), CredentialID: old.CredentialID}
	key := strings.TrimSpace(in.Key)
	if err := next.validate(s.suffix); err != nil {
		return View{}, err
	}
	if next.Endpoint != old.Endpoint && old.CredentialID != "" && key == "" {
		return View{}, errEndpointChanged
	}
	if key != "" {
		if next.Endpoint == "" || !validKey(key) {
			return View{}, errKey
		}
		next.CredentialID = rand.Text()
		secret := []byte(key)
		defer clear(secret)
		if s.vault.Write(next.target(), secret) != nil {
			return View{}, errVault
		}
	}
	if next.Enabled && !s.view(next).HasKey {
		if key != "" {
			_ = s.vault.Delete(next.target())
		}
		return View{}, errKeyRequired
	}
	if err := s.write(next); err != nil {
		if key != "" {
			_ = s.vault.Delete(next.target())
		}
		return View{}, err
	}
	view := s.view(next)
	if old.CredentialID != "" && old.target() != next.target() && s.vault.Delete(old.target()) != nil {
		view.Warning = "旧密钥不再使用，但未能从 Windows 凭据管理器清除。"
	}
	return view, nil
}

func (s *Store) ForgetKey() (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.read()
	if err != nil {
		return View{}, err
	}
	if c.CredentialID != "" && s.vault.Delete(c.target()) != nil {
		return View{}, errVault
	}
	c.Enabled = false
	c.CredentialID = ""
	if err := s.write(c); err != nil {
		return View{}, err
	}
	return s.view(c), nil
}

func (s *Store) view(c config) View {
	hasKey := false
	if c.CredentialID != "" {
		key, err := s.vault.Read(c.target())
		hasKey = err == nil && len(key) != 0
		clear(key)
	}
	return View{Enabled: c.Enabled && hasKey, Endpoint: c.Endpoint, Model: c.Model, HasKey: hasKey}
}

func (c config) target() string {
	digest := sha256.Sum256([]byte(c.Endpoint))
	return "MakeupMirror:AI:v1:" + hex.EncodeToString(digest[:]) + ":" + c.CredentialID
}

func (c config) validate(suffix string) error {
	if c.Endpoint != "" || c.Enabled || c.CredentialID != "" {
		if !validEndpoint(c.Endpoint, suffix) {
			if suffix == "/images/edits" {
				return errors.New("请输入以 /images/edits 结尾的 HTTPS 接口，不含凭据、查询参数或片段。")
			}
			return errEndpoint
		}
		if !modelPattern.MatchString(c.Model) {
			return errModel
		}
	} else if c.Model != "" && !modelPattern.MatchString(c.Model) {
		return errModel
	}
	return nil
}

func validEndpoint(value, suffix string) bool {
	if len(value) > 512 {
		return false
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.ForceQuery || strings.Contains(value, "#") || u.RawPath != "" || !strings.HasSuffix(u.Path, suffix) {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if _, err := netip.ParseAddr(host); err == nil {
		return false
	}
	return strings.Contains(host, ".") && hostPattern.MatchString(host) && !strings.HasSuffix(host, ".") && !strings.HasSuffix(host, ".localhost") && !strings.HasSuffix(host, ".local")
}

func validKey(value string) bool {
	if len(value) == 0 || len(value) > 1024 {
		return false
	}
	for _, r := range value {
		if r < 33 || r > 126 {
			return false
		}
	}
	return true
}

func (s *Store) read() (config, error) {
	var c config
	if !filepath.IsAbs(s.directory) {
		return c, errConfig
	}
	path := filepath.Join(s.directory, s.name)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return c, nil
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4096 {
		return c, errConfig
	}
	file, err := os.Open(path)
	if err != nil {
		return c, errConfig
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !os.SameFile(info, stat) {
		return c, errConfig
	}
	data, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil || len(data) > 4096 || json.Unmarshal(data, &c) != nil || c.validate(s.suffix) != nil || (c.CredentialID != "" && !credentialPattern.MatchString(c.CredentialID)) {
		return config{}, errConfig
	}
	return c, nil
}

func (s *Store) write(c config) error {
	if !filepath.IsAbs(s.directory) || os.MkdirAll(s.directory, 0700) != nil {
		return errSave
	}
	file, err := os.CreateTemp(s.directory, ".provider-*.tmp")
	if err != nil {
		return errSave
	}
	name := file.Name()
	defer os.Remove(name)
	writeErr := json.NewEncoder(file).Encode(c)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil || os.Rename(name, filepath.Join(s.directory, s.name)) != nil {
		return errSave
	}
	return nil
}
