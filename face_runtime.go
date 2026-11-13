//go:build desktop_smoke

package main

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed face-runtime.json
var faceManifestJSON []byte

//go:embed scripts/smoke-face-driver.mjs
var faceFixtureDriver []byte

const faceRuntimePrefix = "/local-face-runtime/"

type faceRuntimeAsset struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	MIME   string `json:"mime"`
}

func faceRuntimeAssets(root string, fixture bool) func(http.Handler) http.Handler {
	var manifest struct {
		Assets map[string]faceRuntimeAsset `json:"assets"`
	}
	if err := json.Unmarshal(faceManifestJSON, &manifest); err != nil {
		log.Fatal(err)
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			name, matches := strings.CutPrefix(r.URL.Path, faceRuntimePrefix)
			if !matches {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			if name == "driver.mjs" {
				w.Header().Set("Content-Type", "text/javascript")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				w.WriteHeader(http.StatusOK)
				if r.Method == http.MethodGet {
					_, _ = w.Write(faceFixtureDriver)
				}
				return
			}
			spec, known := manifest.Assets[name]
			if root == "" || !known {
				http.NotFound(w, r)
				return
			}
			data, ok := readFaceRuntimeAsset(filepath.Join(root, name), spec, fixture)
			if !ok {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", spec.MIME)
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.WriteHeader(http.StatusOK)
			if r.Method == http.MethodGet {
				_, _ = w.Write(data)
			}
		})
	}
}

func readFaceRuntimeAsset(path string, spec faceRuntimeAsset, fixture bool) ([]byte, bool) {
	file, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() || (!fixture && stat.Size() != spec.Size) {
		return nil, false
	}
	data, err := io.ReadAll(io.LimitReader(file, spec.Size+1))
	if err != nil || len(data) == 0 || int64(len(data)) > spec.Size {
		return nil, false
	}
	if !fixture {
		digest := sha256.Sum256(data)
		if int64(len(data)) != spec.Size || hex.EncodeToString(digest[:]) != spec.SHA256 {
			return nil, false
		}
	}
	return data, true
}
