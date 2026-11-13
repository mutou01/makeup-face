package project

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"strings"
)

const maxPNGBytes = 5 * 1024 * 1024

var (
	errPNG     = errors.New("预览图格式或尺寸无效。")
	errPNGName = errors.New("请选择以 .png 结尾的本机文件。")
	errExists  = errors.New("文件已存在，未覆盖。请选择一个新文件名。")
	errExport  = errors.New("无法写入预览图，请检查目录权限和剩余空间。")
)

// ExportPNG re-encodes a bounded work canvas into a new file. Only a path
// returned by the native save dialog should be passed here.
func ExportPNG(path, encoded string) error {
	if len(encoded) > base64.StdEncoding.EncodedLen(maxPNGBytes) {
		return errPNG
	}
	input, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(input) > maxPNGBytes {
		return errPNG
	}
	config, err := png.DecodeConfig(bytes.NewReader(input))
	if err != nil || config.Width < 1 || config.Width > 1024 || config.Height < 1 || config.Height > 1024 {
		return errPNG
	}
	decoded, err := png.Decode(bytes.NewReader(input))
	if err != nil {
		return errPNG
	}
	pixels := image.NewNRGBA(image.Rect(0, 0, config.Width, config.Height))
	draw.Draw(pixels, pixels.Bounds(), decoded, decoded.Bounds().Min, draw.Src)
	var output bytes.Buffer
	if err := png.Encode(&output, pixels); err != nil {
		return errPNG
	}
	return WritePNG(path, output.Bytes())
}

// WritePNG stores already validated, re-encoded PNG bytes without overwriting.
func WritePNG(path string, clean []byte) error {
	err := writeExport(path, ".png", clean, errPNGName)
	if errors.Is(err, os.ErrExist) {
		return errExists
	}
	return err
}

// WriteDiagnostic saves the app's own diagnostic snapshot without overwriting.
func WriteDiagnostic(path string, data []byte) error {
	return writeExport(path, ".json", data, errors.New("请选择以 .json 结尾的本机文件。"))
}

func writeExport(path, extension string, data []byte, invalidName error) error {
	name := filepath.Base(path)
	if !filepath.IsAbs(path) || !strings.EqualFold(filepath.Ext(name), extension) || strings.Contains(name, ":") {
		return invalidName
	}
	root, err := openRoot(filepath.Dir(path))
	if err != nil {
		return invalidName
	}
	defer root.Close()
	if err := writeNew(root, name, data); err != nil {
		if errors.Is(err, os.ErrExist) {
			return os.ErrExist
		}
		return errExport
	}
	return nil
}
