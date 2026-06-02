package proxy

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"sapi/utils"
)

func RelayUpstreamResponse(upstreamResp *http.Response, w http.ResponseWriter) {
	body, _ := io.ReadAll(upstreamResp.Body)
	w.WriteHeader(upstreamResp.StatusCode)
	utils.CopyUpstreamHeaders(upstreamResp.Header, w, nil)
	w.Write(body)
}

func WriteUpstreamStreamToResponse(upstreamResp *http.Response, w http.ResponseWriter) interface{} {
	reader := bufio.NewReader(upstreamResp.Body)

	usageCollector := &streamUsageCollector{}
	var buf strings.Builder
	lineCount := 0
	dataLineCount := 0
	emptyLineCount := 0
	doneSeen := false
	var lastErr error

	for {
		line, err := readSSELine(reader, &buf)
		if err != nil {
			lastErr = err
			break
		}
		lineCount++

		if line == "" {
			emptyLineCount++
		} else {
			if strings.Contains(line, "[DONE]") {
				doneSeen = true
			}
			if strings.HasPrefix(strings.TrimSpace(line), "data:") {
				dataLineCount++
			}
		}

		usageCollector.inspect(line)
		w.Write([]byte(line + "\n"))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}

	log.Printf("[V1CHAT] SSE_STREAM_END total_lines=%d data_lines=%d empty_lines=%d done=%v err=%v",
		lineCount, dataLineCount, emptyLineCount, doneSeen, lastErr)

	return usageCollector.finish()
}

func readSSELine(reader *bufio.Reader, buf *strings.Builder) (string, error) {
	for {
		b, err := reader.ReadByte()
		if err != nil {
			if buf.Len() > 0 {
				result := buf.String()
				buf.Reset()
				return result, nil
			}
			return "", err
		}
		if b == '\n' {
			result := buf.String()
			buf.Reset()
			return result, nil
		}
		if b != '\r' {
			buf.WriteByte(b)
		}
	}
}

type streamUsageCollector struct {
	buffer string
	usage  interface{}
}

func (c *streamUsageCollector) inspect(line string) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, ":") {
		return
	}

	item := trimmed
	if strings.HasPrefix(trimmed, "data:") {
		item = strings.TrimSpace(trimmed[5:])
	}
	if item == "" || item == "[DONE]" || (!strings.HasPrefix(item, "{") && !strings.HasPrefix(item, "[")) {
		return
	}

	var payload interface{}
	if err := json.Unmarshal([]byte(item), &payload); err == nil {
		if usage := utils.FindUsagePayload(payload); usage != nil {
			c.usage = usage
		}
	}
}

func (c *streamUsageCollector) finish() interface{} {
	return c.usage
}

func RelayStreamToAnthropic(upstreamResp *http.Response, w http.ResponseWriter) {
	reader := bufio.NewReader(upstreamResp.Body)
	var buf strings.Builder

	for {
		line, err := readSSELine(reader, &buf)
		if err != nil {
			break
		}
		w.Write([]byte(line + "\n"))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}
}

func ProxyRequest(method, url string, headers http.Header, body io.Reader) (*http.Response, error) {
	client := &http.Client{
		Timeout: 5 * time.Minute,
	}

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}

	for key, values := range headers {
		for _, val := range values {
			req.Header.Add(key, val)
		}
	}

	return client.Do(req)
}
