package photo

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	_ "image/jpeg" // Register the supported image decoders.
	_ "image/png"
	"io"
	"path/filepath"
	"strings"

	_ "golang.org/x/image/webp"
)

const (
	maxBytes  = 15 * 1024 * 1024
	maxPixels = 24_000_000
)

var (
	ErrFormat     = errors.New("仅支持 JPEG、PNG 和 WebP，扩展名必须与文件内容一致")
	ErrRead       = errors.New("无法读取照片")
	ErrSize       = errors.New("照片文件不得超过 15 MiB")
	ErrDimensions = errors.New("照片不得超过 2400 万像素")
	ErrAnimated   = errors.New("请选择一张静态照片")
	ErrCorrupt    = errors.New("照片内容损坏或无法解码")
)

type Info struct {
	Format        string
	Width, Height int
}

// Inspect validates the encoded contents without keeping pixels or opening files.
// The name supplies only a declared extension. Width and height are as encoded.
func Inspect(filename string, input io.Reader) (Info, error) {
	info, _, err := Read(filename, input)
	return info, err
}

// Read validates one bounded snapshot, returning its original bytes only on success.
func Read(filename string, input io.Reader) (Info, []byte, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	var declared string
	switch ext {
	case ".jpg", ".jpeg":
		declared = "jpeg"
	case ".png", ".webp":
		declared = ext[1:]
	default:
		return Info{}, nil, ErrFormat
	}
	data, err := io.ReadAll(io.LimitReader(input, maxBytes+1))
	if err != nil {
		return Info{}, nil, ErrRead
	}
	if len(data) > maxBytes {
		return Info{}, nil, ErrSize
	}
	info, err := inspectEncoded(declared, data)
	if err != nil {
		return Info{}, nil, err
	}
	return info, data, nil
}

func inspectEncoded(declared string, data []byte) (Info, error) {
	format := sniffFormat(data)
	if format == "" {
		return Info{}, ErrCorrupt
	}
	if format != declared {
		return Info{}, ErrFormat
	}
	switch format {
	case "png":
		if err := checkStaticPNG(data); err != nil {
			return Info{}, err
		}
	case "webp":
		if err := checkStaticWebP(data); err != nil {
			return Info{}, err
		}
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return Info{}, ErrCorrupt
	}
	if config.Width < 1 || config.Height < 1 || config.Width > maxPixels/config.Height {
		return Info{}, ErrDimensions
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil || decoded.Bounds().Dx() != config.Width || decoded.Bounds().Dy() != config.Height {
		return Info{}, ErrCorrupt
	}
	return Info{Format: format, Width: config.Width, Height: config.Height}, nil
}

func sniffFormat(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		return "jpeg"
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "png"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "webp"
	default:
		return ""
	}
}

func checkStaticPNG(data []byte) error {
	// Length, chunk type, payload, CRC. Go's decoder handles CRC and pixel validation.
	for chunk := data[8:]; len(chunk) >= 12; {
		size := uint64(binary.BigEndian.Uint32(chunk[:4]))
		if size > uint64(len(chunk)-12) {
			return ErrCorrupt
		}
		next := 12 + int(size)
		switch string(chunk[4:8]) {
		case "acTL", "fcTL", "fdAT":
			return ErrAnimated
		case "IEND":
			if size != 0 || next != len(chunk) {
				return ErrCorrupt
			}
			return nil
		}
		chunk = chunk[next:]
	}
	return ErrCorrupt
}

func checkStaticWebP(data []byte) error {
	if uint64(binary.LittleEndian.Uint32(data[4:8]))+8 != uint64(len(data)) {
		return ErrCorrupt
	}
	first, frames := true, 0
	for chunk := data[12:]; len(chunk) > 0; {
		if len(chunk) < 8 {
			return ErrCorrupt
		}
		size := uint64(binary.LittleEndian.Uint32(chunk[4:8]))
		padded := size + size%2
		if padded > uint64(len(chunk)-8) {
			return ErrCorrupt
		}
		switch string(chunk[:4]) {
		case "VP8X":
			if !first || size != 10 {
				return ErrCorrupt
			}
			if chunk[8]&0x02 != 0 {
				return ErrAnimated
			}
		case "ANIM", "ANMF":
			return ErrAnimated
		case "VP8 ", "VP8L":
			frames++
		}
		chunk = chunk[8+int(padded):]
		first = false
	}
	if frames != 1 {
		return ErrCorrupt
	}
	return nil
}
