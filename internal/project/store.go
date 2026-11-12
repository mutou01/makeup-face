package project

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"makeupmirror/internal/photo"
)

const (
	filename = "project.json"
	kind     = "makeupmirror-project"
	version  = 1
	maxBytes = 22 * 1024 * 1024
)

var (
	ErrDirectory = errors.New("请选择本机目录。")
	ErrNotEmpty  = errors.New("请选择空目录新建项目。")
	ErrInvalid   = errors.New("该目录没有可读取的妆容项目，或项目文件已损坏。")
	ErrChanged   = errors.New("项目文件已被修改，请重新打开后再保存。")
	ErrWrite     = errors.New("无法写入项目，请检查目录权限和剩余空间。")
	colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

type Layer struct {
	Enabled  bool   `json:"enabled"`
	Color    string `json:"color"`
	Strength int    `json:"strength"`
}

type Draft struct {
	Scene    string           `json:"scene"`
	Look     string           `json:"look"`
	Analyzed bool             `json:"analyzed"`
	Layers   map[string]Layer `json:"layers"`
}

type Photo struct {
	Format string `json:"format"`
	Bytes  []byte `json:"bytes"`
}

type Snapshot struct {
	Kind    string `json:"kind"`
	Version int    `json:"version"`
	Photo   *Photo `json:"photo,omitempty"`
	Draft   *Draft `json:"draft,omitempty"`
}

// Store owns a directory handle chosen by the user. The desktop caller serializes operations.
type Store struct {
	root     *os.Root
	revision [sha256.Size]byte
}

func Create(path string) (*Store, error) {
	root, err := openRoot(path)
	if err != nil {
		return nil, err
	}
	defer func() {
		if root != nil {
			_ = root.Close()
		}
	}()
	dir, err := root.Open(".")
	if err != nil {
		return nil, ErrDirectory
	}
	entries, listErr := dir.ReadDir(1)
	_ = dir.Close()
	if len(entries) != 0 {
		return nil, ErrNotEmpty
	}
	if !errors.Is(listErr, io.EOF) {
		return nil, ErrDirectory
	}
	data, err := encode(Snapshot{})
	if err != nil {
		return nil, err
	}
	if err := writeNew(root, filename, data); err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, ErrNotEmpty
		}
		return nil, ErrWrite
	}
	store := &Store{root: root, revision: sha256.Sum256(data)}
	root = nil
	return store, nil
}

func Open(path string) (*Store, Snapshot, error) {
	root, err := openRoot(path)
	if err != nil {
		return nil, Snapshot{}, err
	}
	data, err := readCurrent(root)
	if err != nil {
		_ = root.Close()
		return nil, Snapshot{}, ErrInvalid
	}
	var snapshot Snapshot
	if json.Unmarshal(data, &snapshot) != nil || snapshot.Kind != kind || snapshot.Version != version || !valid(snapshot) {
		_ = root.Close()
		return nil, Snapshot{}, ErrInvalid
	}
	return &Store{root: root, revision: sha256.Sum256(data)}, snapshot, nil
}

func (s *Store) Close() { _ = s.root.Close() }

func (s *Store) Save(snapshot Snapshot) error {
	data, err := encode(snapshot)
	if err != nil {
		return err
	}
	temp := ".makeupmirror-" + rand.Text() + ".tmp"
	if err := writeNew(s.root, temp, data); err != nil {
		return ErrWrite
	}
	defer s.root.Remove(temp)
	current, err := readCurrent(s.root)
	if err != nil || sha256.Sum256(current) != s.revision {
		return ErrChanged
	}
	if err := s.root.Rename(temp, filename); err != nil {
		return ErrWrite
	}
	s.revision = sha256.Sum256(data)
	return nil
}

func openRoot(path string) (*os.Root, error) {
	if !filepath.IsAbs(path) || strings.HasPrefix(path, `\\`) {
		return nil, ErrDirectory
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, ErrDirectory
	}
	return root, nil
}

func readCurrent(root *os.Root) ([]byte, error) {
	entry, err := root.Lstat(filename)
	if err != nil || !entry.Mode().IsRegular() {
		return nil, ErrInvalid
	}
	file, err := root.Open(filename)
	if err != nil {
		return nil, ErrInvalid
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !os.SameFile(entry, stat) || stat.Size() > maxBytes {
		return nil, ErrInvalid
	}
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil || len(data) > maxBytes {
		return nil, ErrInvalid
	}
	return data, nil
}

func writeNew(root *os.Root, name string, data []byte) error {
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	stat, _ := file.Stat()
	_, writeErr := file.Write(data)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	err = errors.Join(writeErr, closeErr)
	if err != nil && stat != nil {
		if entry, checkErr := root.Lstat(name); checkErr == nil && os.SameFile(stat, entry) {
			_ = root.Remove(name)
		}
	}
	return err
}

func encode(snapshot Snapshot) ([]byte, error) {
	snapshot.Kind = kind
	snapshot.Version = version
	if !valid(snapshot) {
		return nil, ErrInvalid
	}
	data, err := json.Marshal(snapshot)
	if err != nil || len(data) >= maxBytes {
		return nil, ErrInvalid
	}
	return append(data, '\n'), nil
}

func valid(snapshot Snapshot) bool {
	if snapshot.Draft == nil {
		return snapshot.Photo == nil
	}
	draft := snapshot.Draft
	switch draft.Scene {
	case "any", "daily", "photo", "party":
	default:
		return false
	}
	switch draft.Look {
	case "any", "natural", "warm", "bold":
	default:
		return false
	}
	if len(draft.Layers) != 3 {
		return false
	}
	for _, name := range []string{"lipstick", "blush", "eyeshadow"} {
		layer, exists := draft.Layers[name]
		if !exists || !colorPattern.MatchString(layer.Color) || layer.Strength < 0 || layer.Strength > 100 {
			return false
		}
	}
	if snapshot.Photo == nil {
		return !draft.Analyzed
	}
	p := snapshot.Photo
	info, err := photo.Inspect("photo."+p.Format, bytes.NewReader(p.Bytes))
	return err == nil && info.Format == p.Format
}
