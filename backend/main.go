package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"sapi/config"
	"sapi/handlers"
	"sapi/middleware"
	"sapi/proxy"
	"sapi/security"
	"sapi/store"
)

type gzipStaticEntry struct {
	modTime     time.Time
	size        int64
	contentType string
	data        []byte
}

var (
	gzipStaticMu    sync.RWMutex
	gzipStaticCache = map[string]gzipStaticEntry{}
)

func main() {
	cfg := config.Load()

	setupDiagnosticLog()

	if err := store.Init(context.Background(), cfg); err != nil {
		log.Fatalf("store initialization failed: %v", err)
	}
	defer store.Close()

	if err := security.Init(context.Background(), cfg); err != nil {
		log.Fatalf("security initialization failed: %v", err)
	}
	defer security.Close()

	mux := http.NewServeMux()

	handlers.MountPublicRoutes(mux)
	handlers.MountAuthRoutes(mux)
	handlers.MountUserRoutes(mux)
	handlers.MountAdminRoutes(mux)
	handlers.MountProxyRoutes(mux)

	var spaHandler http.HandlerFunc
	publicDir := filepath.Join(getBaseDir(), "..", "public")
	if _, err := os.Stat(publicDir); err == nil {
		spaHandler = buildSpaHandler(publicDir)
	}

	handler := security.RequestGuard(middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isAPIPath(r.URL.Path) {
			mux.ServeHTTP(newDynamicNoStoreResponseWriter(w), r)
			return
		}

		if spaHandler != nil {
			spaHandler(w, r)
		} else {
			mux.ServeHTTP(w, r)
		}
	})))

	wrappedHandler := loggingMiddleware(handler)

	go func() {
		proxy.RunHealthChecks()
		ticker := time.NewTicker(60 * time.Second)
		for range ticker.C {
			proxy.RunHealthChecks()
		}
	}()

	fmt.Printf("SAPI is running at http://localhost:%d\n", cfg.Port)
	fmt.Printf("Admin console: http://localhost:%d/#admin\n", cfg.Port)

	if err := http.ListenAndServe(fmt.Sprintf(":%d", cfg.Port), wrappedHandler); err != nil {
		log.Fatal(err)
	}
}

func isAPIPath(p string) bool {
	return pathMatches(p, "/api") || pathMatches(p, "/v1") ||
		pathMatches(p, "/responses") || pathMatches(p, "/messages") ||
		p == "/chat/completions" || pathMatches(p, "/models") ||
		pathMatches(p, "/swagger")
}

func pathMatches(path, prefix string) bool {
	return path == prefix || strings.HasPrefix(path, prefix+"/")
}

func buildSpaHandler(publicDir string) http.HandlerFunc {
	fs := http.FileServer(http.Dir(publicDir))
	indexPath := filepath.Join(publicDir, "index.html")
	indexHTML, indexErr := os.ReadFile(indexPath)

	return func(w http.ResponseWriter, r *http.Request) {
		if !isAPIPath(r.URL.Path) && r.URL.Path != "/swagger" {
			path := filepath.Join(publicDir, filepath.Clean(r.URL.Path))
			if info, err := os.Stat(path); err == nil && !info.IsDir() {
				setStaticCacheHeader(w, r.URL.Path)
				if serveGzipStaticFile(w, r, path, info) {
					return
				}
				fs.ServeHTTP(w, r)
				return
			}

			if indexErr == nil {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Write(indexHTML)
				return
			}
		}

		fs.ServeHTTP(w, r)
	}
}

func setStaticCacheHeader(w http.ResponseWriter, requestPath string) {
	if strings.HasPrefix(requestPath, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
}

type dynamicNoStoreResponseWriter struct {
	http.ResponseWriter
}

func newDynamicNoStoreResponseWriter(w http.ResponseWriter) http.ResponseWriter {
	setDynamicNoStoreHeaders(w.Header())
	return &dynamicNoStoreResponseWriter{ResponseWriter: w}
}

func (rw *dynamicNoStoreResponseWriter) WriteHeader(code int) {
	setDynamicNoStoreHeaders(rw.Header())
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *dynamicNoStoreResponseWriter) Write(data []byte) (int, error) {
	setDynamicNoStoreHeaders(rw.Header())
	return rw.ResponseWriter.Write(data)
}

func setDynamicNoStoreHeaders(header http.Header) {
	header.Set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate, private")
	header.Set("CDN-Cache-Control", "no-store")
	header.Set("Surrogate-Control", "no-store")
	header.Set("Pragma", "no-cache")
	header.Set("Expires", "0")
	addVaryHeader(header, "Authorization")
	addVaryHeader(header, "X-API-Key")
	addVaryHeader(header, "Cookie")
}

func serveGzipStaticFile(w http.ResponseWriter, r *http.Request, filePath string, info os.FileInfo) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if r.Header.Get("Range") != "" || !acceptsGzip(r.Header.Get("Accept-Encoding")) {
		return false
	}
	if !isCompressibleStaticFile(filePath) {
		return false
	}

	entry, ok := getGzipStaticEntry(filePath, info)
	if !ok {
		return false
	}

	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Set("Content-Length", strconv.Itoa(len(entry.data)))
	w.Header().Set("Content-Type", entry.contentType)
	addVaryHeader(w.Header(), "Accept-Encoding")
	http.ServeContent(w, r, filepath.Base(filePath), entry.modTime, bytes.NewReader(entry.data))
	return true
}

func getGzipStaticEntry(filePath string, info os.FileInfo) (gzipStaticEntry, bool) {
	gzipStaticMu.RLock()
	entry, ok := gzipStaticCache[filePath]
	gzipStaticMu.RUnlock()
	if ok && entry.size == info.Size() && entry.modTime.Equal(info.ModTime()) {
		return entry, true
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return gzipStaticEntry{}, false
	}

	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		return gzipStaticEntry{}, false
	}
	if _, err := zw.Write(data); err != nil {
		_ = zw.Close()
		return gzipStaticEntry{}, false
	}
	if err := zw.Close(); err != nil {
		return gzipStaticEntry{}, false
	}
	if buf.Len() >= len(data) {
		return gzipStaticEntry{}, false
	}

	entry = gzipStaticEntry{
		modTime:     info.ModTime(),
		size:        info.Size(),
		contentType: staticContentType(filePath, data),
		data:        buf.Bytes(),
	}

	gzipStaticMu.Lock()
	gzipStaticCache[filePath] = entry
	gzipStaticMu.Unlock()

	return entry, true
}

func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		items := strings.Split(strings.TrimSpace(strings.ToLower(part)), ";")
		if len(items) == 0 || strings.TrimSpace(items[0]) != "gzip" {
			continue
		}
		for _, param := range items[1:] {
			param = strings.TrimSpace(param)
			if param == "q=0" || param == "q=0.0" || param == "q=0.00" {
				return false
			}
		}
		return true
	}
	return false
}

func isCompressibleStaticFile(filePath string) bool {
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".css", ".html", ".js", ".json", ".map", ".mjs", ".svg", ".txt", ".wasm", ".xml":
		return true
	default:
		return false
	}
}

func staticContentType(filePath string, data []byte) string {
	if contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(filePath))); contentType != "" {
		return contentType
	}
	if len(data) > 512 {
		data = data[:512]
	}
	return http.DetectContentType(data)
}

func addVaryHeader(header http.Header, value string) {
	for _, existing := range header.Values("Vary") {
		for _, part := range strings.Split(existing, ",") {
			if strings.EqualFold(strings.TrimSpace(part), value) {
				return
			}
		}
	}
	header.Add("Vary", value)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &responseWriter{ResponseWriter: w, statusCode: 200}

		next.ServeHTTP(ww, r)

		duration := time.Since(start).Milliseconds()
		statusColor := "\033[32m"
		statusLabel := "OK"
		if ww.statusCode >= 400 {
			statusColor = "\033[31m"
			statusLabel = "FAIL"
		}

		ts := time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01-02 15:04:05")
		fmt.Printf("\033[2m[%s]\033[0m \033[36m%s\033[0m \033[1m%s\033[0m %s\033[1m%d %s\033[0m \033[2m%dms\033[0m\n",
			ts, r.Method, r.URL.Path, statusColor, ww.statusCode, statusLabel, duration)
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func getBaseDir() string {
	exe, err := os.Executable()
	if err == nil {
		return filepath.Dir(exe)
	}
	_, file, _, ok := runtime.Caller(0)
	if ok {
		return filepath.Dir(file)
	}
	return "."
}

func setupDiagnosticLog() {
	cwd, _ := os.Getwd()
	logDir := filepath.Join(cwd, "logs")
	os.MkdirAll(logDir, 0755)
	timestamp := time.Now().Format("2006-01-02")
	logPath := filepath.Join(logDir, "v1chat-"+timestamp+".log")
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Printf("WARN: cannot create diagnostic log file %s: %v\n", logPath, err)
		return
	}
	log.SetOutput(io.MultiWriter(os.Stderr, f))
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.Printf("[V1CHAT] === LOG STARTED === cwd=%s log=%s", cwd, logPath)
	fmt.Printf("Diagnostic log: %s\n", logPath)
}
