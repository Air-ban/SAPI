package proxy

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"

	"sapi/utils"
)

func RelayUpstreamResponse(upstreamResp *http.Response, w http.ResponseWriter) {
	body, _ := io.ReadAll(upstreamResp.Body)
	utils.CopyUpstreamHeaders(upstreamResp.Header, w, nil)
	w.WriteHeader(upstreamResp.StatusCode)
	w.Write(body)
}

func WriteUpstreamStreamToResponse(upstreamResp *http.Response, w http.ResponseWriter) interface{} {
	usageCollector := &streamUsageCollector{}
	buf := make([]byte, 16*1024)
	chunkCount := 0
	byteCount := 0
	var lastErr error

	for {
		n, err := upstreamResp.Body.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			usageCollector.inspectChunk(chunk)
			if _, writeErr := w.Write(chunk); writeErr != nil {
				lastErr = writeErr
				break
			}
			chunkCount++
			byteCount += n
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
		if err != nil {
			if err != io.EOF {
				lastErr = err
			}
			break
		}
	}
	usageCollector.finishChunk()

	log.Printf("[V1CHAT] SSE_STREAM_END chunks=%d bytes=%d err=%v", chunkCount, byteCount, lastErr)

	return usageCollector.finish()
}

func readSSELine(reader *bufio.Reader, buf *strings.Builder) (string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		if len(line) == 0 && buf.Len() == 0 {
			return "", err
		}
		buf.WriteString(line)
		result := strings.TrimRight(buf.String(), "\r\n")
		buf.Reset()
		return result, nil
	}
	buf.WriteString(line)
	result := strings.TrimRight(buf.String(), "\r\n")
	buf.Reset()
	return result, nil
}

type streamUsageCollector struct {
	buffer strings.Builder
	usage  interface{}
}

func (c *streamUsageCollector) inspectChunk(chunk []byte) {
	for _, b := range chunk {
		if b == '\n' {
			line := strings.TrimRight(c.buffer.String(), "\r")
			c.buffer.Reset()
			c.inspect(line)
			continue
		}
		c.buffer.WriteByte(b)
	}
}

func (c *streamUsageCollector) finishChunk() {
	if c.buffer.Len() == 0 {
		return
	}
	c.inspect(strings.TrimRight(c.buffer.String(), "\r"))
	c.buffer.Reset()
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
	buf := make([]byte, 16*1024)
	for {
		n, err := upstreamResp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				break
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
		if err != nil {
			break
		}
	}
}

func ProxyRequest(method, url string, headers http.Header, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}

	for key, values := range headers {
		for _, val := range values {
			req.Header.Add(key, val)
		}
	}

	return DoUpstream(req)
}
