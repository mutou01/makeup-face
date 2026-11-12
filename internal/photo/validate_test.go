package photo_test

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"testing"
	"testing/iotest"

	"makeupmirror/internal/photo"
)

func encoded(t *testing.T, encode func(io.Writer, image.Image) error) []byte {
	t.Helper()
	var data bytes.Buffer
	if err := encode(&data, image.NewRGBA(image.Rect(0, 0, 2, 3))); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func fixture(t *testing.T, encoded string) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

type zeroReader struct{ bytesRead int }

func (r *zeroReader) Read(p []byte) (int, error) {
	clear(p)
	r.bytesRead += len(p)
	return len(p), nil
}

func TestInspectLocalPhoto(t *testing.T) {
	jpg := encoded(t, func(w io.Writer, m image.Image) error { return jpeg.Encode(w, m, nil) })
	pngImage := encoded(t, png.Encode)
	// Synthetic 2 × 3 images encoded independently of the implementation.
	webp := fixture(t, "UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQkeIVp/+BiOh/AAA=")
	animatedWebP := fixture(t, "UklGRogAAABXRUJQVlA4WAoAAAACAAAAAQAAAgAAQU5JTQYAAAAAAAAAAABBTk1GKgAAAAAAAAAAAAEAAAIAAGQAAAJWUDhMEQAAAC8BgAAAB1CR4hWn/4GI6H8AAEFOTUYqAAAAAAAAAAAAAQAAAgAAZAAAAFZQOEwRAAAALwGAAAAHULyKFKf/gYjofwAA")
	animatedPNG := fixture(t, "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAwAAAAAAAAAAAGQD6AAAuK5U9QAAABRJREFUeJxjrFCyYGBgYGJgYEBQABAqANhwQ/aDAAAAGmZjVEwAAAABAAAAAgAAAAMAAAAAAAAAAABkA+gAACPdviEAAAAYZmRBVAAAAAJ4nGNUqrBgYGBgYmBgQFAAD9QA2P1fANMAAAAASUVORK5CYII=")
	largePNG := append([]byte(nil), pngImage...)
	binary.BigEndian.PutUint32(largePNG[16:20], 6000)
	binary.BigEndian.PutUint32(largePNG[20:24], 4001)
	binary.BigEndian.PutUint32(largePNG[29:33], crc32.ChecksumIEEE(largePNG[12:29]))
	brokenPNG := append([]byte(nil), pngImage...)
	idat := bytes.Index(brokenPNG, []byte("IDAT"))
	idatEnd := idat + 4 + int(binary.BigEndian.Uint32(brokenPNG[idat-4:idat]))
	brokenPNG[idat+4] = 0 // Invalid zlib stream inside a structurally valid PNG chunk.
	binary.BigEndian.PutUint32(brokenPNG[idatEnd:idatEnd+4], crc32.ChecksumIEEE(brokenPNG[idat:idatEnd]))

	for _, tc := range []struct {
		label, filename string
		data            []byte
		format          string
		wantErr         error
	}{
		{"accept JPEG with uppercase extension", "face.JPG", jpg, "jpeg", nil},
		{"accept JPEG with long extension", "face.jpeg", jpg, "jpeg", nil},
		{"accept PNG", "face.png", pngImage, "png", nil},
		{"accept WebP", "face.webp", webp, "webp", nil},
		{"reject unsupported extension", "face.gif", pngImage, "", photo.ErrFormat},
		{"reject mismatched extension", "face.jpg", pngImage, "", photo.ErrFormat},
		{"reject unreadable content", "face.png", []byte("not a photo"), "", photo.ErrCorrupt},
		{"reject valid header with missing final image data", "face.png", pngImage[:len(pngImage)-12], "", photo.ErrCorrupt},
		{"reject corrupt compressed pixels even when PNG chunks are valid", "face.png", brokenPNG, "", photo.ErrCorrupt},
		{"reject huge dimensions before decoding small payload", "face.png", largePNG, "", photo.ErrDimensions},
		{"reject animated PNG", "face.png", animatedPNG, "", photo.ErrAnimated},
		{"reject animated WebP", "face.webp", animatedWebP, "", photo.ErrAnimated},
		{"reject truncated WebP", "face.webp", webp[:len(webp)-2], "", photo.ErrCorrupt},
	} {
		t.Run(tc.label, func(t *testing.T) {
			got, err := photo.Inspect(tc.filename, bytes.NewReader(tc.data))
			if err != tc.wantErr {
				t.Fatalf("error = %v, want %v", err, tc.wantErr)
			}
			if tc.wantErr == nil {
				want := photo.Info{Format: tc.format, Width: 2, Height: 3}
				if got != want {
					t.Fatalf("info = %+v, want %+v", got, want)
				}
			} else if got != (photo.Info{}) {
				t.Fatalf("rejected image produced metadata: %+v", got)
			}
		})
	}

	t.Run("reject and stop reading over 15 MiB", func(t *testing.T) {
		input := new(zeroReader)
		if _, err := photo.Inspect("face.jpg", input); err != photo.ErrSize {
			t.Fatalf("error = %v, want size error", err)
		}
		if input.bytesRead != 15*1024*1024+1 {
			t.Fatalf("read %d bytes, want at most 15 MiB plus one byte", input.bytesRead)
		}
	})

	t.Run("report source read errors separately", func(t *testing.T) {
		if _, err := photo.Inspect("face.jpg", iotest.ErrReader(os.ErrPermission)); err != photo.ErrRead {
			t.Fatalf("error = %v, want read error", err)
		}
	})
}
