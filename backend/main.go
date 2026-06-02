package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"sapi/config"
	"sapi/handlers"
	"sapi/middleware"
	"sapi/proxy"
)

func main() {
	cfg := config.Load()

	setupDiagnosticLog()

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

	handler := middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isAPIPath(r.URL.Path) {
			mux.ServeHTTP(w, r)
			return
		}

		if spaHandler != nil {
			spaHandler(w, r)
		} else {
			mux.ServeHTTP(w, r)
		}
	}))

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
	return strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/v1/") ||
		strings.HasPrefix(p, "/messages") || p == "/responses" || p == "/chat/completions" ||
		p == "/models" || p == "/swagger" || strings.HasPrefix(p, "/swagger")
}

func buildSpaHandler(publicDir string) http.HandlerFunc {
	fs := http.FileServer(http.Dir(publicDir))
	indexPath := filepath.Join(publicDir, "index.html")
	indexHTML, indexErr := os.ReadFile(indexPath)

	return func(w http.ResponseWriter, r *http.Request) {
		if !isAPIPath(r.URL.Path) && r.URL.Path != "/swagger" && r.URL.Path != "/models" {
			w.Header().Set("Cache-Control", "no-store")
			path := filepath.Join(publicDir, filepath.Clean(r.URL.Path))
			if info, err := os.Stat(path); err == nil && !info.IsDir() {
				fs.ServeHTTP(w, r)
				return
			}

			if indexErr == nil {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Write(indexHTML)
				return
			}
		}

		fs.ServeHTTP(w, r)
	}
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
	_, file, _, ok := runtime.Caller(0)
	if ok {
		return filepath.Dir(file)
	}
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
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
