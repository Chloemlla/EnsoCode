package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"
)

// 与 src/main/services/remoteRenderer/assets.test.ts 同一份样例：两边算出的 id 必须一致
const fixtureBundleID = "8832e4e906adc9ed3a64e64d5910f3cf121c36faf9b39c7748ac9ec1d1f304b6"

func bundleFixture() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                    {Data: []byte("phone")},
		"desk-bundle/index.html":        {Data: []byte("<html>")},
		"desk-bundle/settings.html":     {Data: []byte("<html>")},
		"desk-bundle/web-preload.js":    {Data: []byte("void 0")},
		"desk-bundle/assets/a.js":       {Data: []byte("export {}")},
		"desk-bundle/assets/a.js.map":   {Data: []byte("{}")},
		"desk-bundle/fonts/f.ttf":       {Data: []byte("x")},
		"desk-bundle/assets/big-abc.js": {Data: bytes.Repeat([]byte("const a = 1;\n"), 2000)},
	}
}

func bundleServer(t *testing.T, static fstest.MapFS) *httptest.Server {
	t.Helper()
	st, err := openStore(filepath.Join(t.TempDir(), "relay.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })
	hs := httptest.NewServer(newServer(st, static, nil))
	t.Cleanup(hs.Close)
	return hs
}

func fetch(t *testing.T, url string, gz bool) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if gz {
		req.Header.Set("Accept-Encoding", "gzip")
	}
	res, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

func TestDeskBundleManifestMatchesDesktop(t *testing.T) {
	fixture := bundleFixture()
	delete(fixture, "desk-bundle/assets/big-abc.js")
	b := loadDeskBundle(fixture)
	if b == nil || b.id != fixtureBundleID {
		t.Fatalf("bundle %+v", b)
	}
	if loadDeskBundle(fstest.MapFS{"index.html": {Data: []byte("x")}}) != nil {
		t.Fatal("no bundle expected")
	}
}

func TestDeskBundleServing(t *testing.T) {
	fixture := bundleFixture()
	hs := bundleServer(t, fixture)
	b := loadDeskBundle(fixture)
	base := hs.URL + "/desk-bundle/" + b.id

	res, body := fetch(t, base, false)
	if res.StatusCode != 200 || string(body) != string(b.manifest) {
		t.Fatalf("manifest %d %q", res.StatusCode, body)
	}
	res, body = fetch(t, base+"/assets/a.js", false)
	if res.StatusCode != 200 || string(body) != "export {}" {
		t.Fatalf("file %d %q", res.StatusCode, body)
	}
	if res.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatal("missing CORS")
	}
	for _, p := range []string{
		"/desk-bundle/" + fixtureBundleID + "/assets/a.js", // 别的构建
		"/desk-bundle/" + b.id + "/index.html",             // 入口页由桌面注入后下发
		"/desk-bundle/" + b.id + "/assets/a.js.map",
		"/desk-bundle/" + b.id + "/missing.js",
		"/desk-bundle/" + b.id + "/../index.html",
	} {
		if res, body := fetch(t, hs.URL+p, false); res.StatusCode != 404 || string(body) == "phone" {
			t.Fatalf("%s => %d %q", p, res.StatusCode, body)
		}
	}

	res, body = fetch(t, base+"/assets/big-abc.js", true)
	if res.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("encoding %q", res.Header.Get("Content-Encoding"))
	}
	zr, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	plain, _ := io.ReadAll(zr)
	if !bytes.Equal(plain, fixture["desk-bundle/assets/big-abc.js"].Data) || len(body) >= len(plain)/5 {
		t.Fatalf("gzip %d -> %d", len(plain), len(body))
	}
}
