package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"sort"
	"strings"
	"sync"
)

// 发布时把桌面 renderer 产物打进 frontend/desk-bundle：手机完整版按电脑报来的清单 id 直接从中继取，
// 不再经加密隧道从电脑上行慢慢拉。中继不受信任，手机按清单逐个校验 sha256。
const deskBundleDir = "desk-bundle"

type deskBundle struct {
	id       string
	manifest []byte
	files    map[string]bool
	fsys     fs.FS
	gz       sync.Map
}

// 清单算法须与 src/main/services/remoteRenderer/assets.ts bundleManifest 一致
func loadDeskBundle(static fs.FS) *deskBundle {
	sub, err := fs.Sub(static, deskBundleDir)
	if err != nil {
		return nil
	}
	var lines []string
	files := map[string]bool{}
	err = fs.WalkDir(sub, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.Type().IsRegular() {
			return err
		}
		if p == "index.html" || p == "settings.html" || strings.HasSuffix(p, ".map") {
			return nil
		}
		data, err := fs.ReadFile(sub, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		lines = append(lines, hex.EncodeToString(sum[:])+"  "+p+"\n")
		files[p] = true
		return nil
	})
	if err != nil || len(lines) == 0 {
		return nil
	}
	sort.Slice(lines, func(i, j int) bool { return lines[i][66:] < lines[j][66:] })
	manifest := []byte(strings.Join(lines, ""))
	sum := sha256.Sum256(manifest)
	return &deskBundle{id: hex.EncodeToString(sum[:]), manifest: manifest, files: files, fsys: sub}
}

var incompressible = map[string]bool{".woff2": true, ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".mp3": true}

// rest：/desk-bundle/ 之后的部分，「<id>」取清单，「<id>/<path>」取文件
func (b *deskBundle) serve(w http.ResponseWriter, r *http.Request, rest string) {
	id, file, _ := strings.Cut(rest, "/")
	if b == nil || id != b.id || (file != "" && !b.files[file]) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeCORS(w)
	h := w.Header()
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	if file == "" {
		h.Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(b.manifest)
		return
	}
	data, err := fs.ReadFile(b.fsys, file)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	ext := path.Ext(file)
	if ctype := mime.TypeByExtension(ext); ctype != "" {
		h.Set("Content-Type", ctype)
	}
	h.Add("Vary", "Accept-Encoding")
	if !incompressible[ext] && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		_, _ = w.Write(b.gzipped(file, data))
		return
	}
	_, _ = w.Write(data)
}

func (b *deskBundle) gzipped(file string, data []byte) []byte {
	if hit, ok := b.gz.Load(file); ok {
		return hit.([]byte)
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	_, _ = zw.Write(data)
	_ = zw.Close()
	b.gz.Store(file, buf.Bytes())
	return buf.Bytes()
}
