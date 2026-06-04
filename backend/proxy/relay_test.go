package proxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteUpstreamStreamToResponseForwardsPartialLineChunks(t *testing.T) {
	upstreamResp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"hel")),
	}
	rec := httptest.NewRecorder()

	usage := WriteUpstreamStreamToResponse(upstreamResp, rec)

	if rec.Body.String() != "data: {\"choices\":[{\"delta\":{\"content\":\"hel" {
		t.Fatalf("expected partial line to be forwarded immediately, got %q", rec.Body.String())
	}
	if usage != nil {
		t.Fatalf("expected no usage for partial chunk, got %#v", usage)
	}
}

func TestWriteUpstreamStreamToResponseCollectsUsageAcrossChunks(t *testing.T) {
	upstreamResp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body: io.NopCloser(strings.NewReader(strings.Join([]string{
			"data: {\"usage\":{\"prompt_tokens\":1,",
			"\"completion_tokens\":2,\"total_tokens\":3}}\n",
			"data: [DONE]\n",
		}, ""))),
	}
	rec := httptest.NewRecorder()

	usage := WriteUpstreamStreamToResponse(upstreamResp, rec)
	usageMap, ok := usage.(map[string]interface{})
	if !ok {
		t.Fatalf("expected usage map, got %#v", usage)
	}
	if usageMap["total_tokens"].(float64) != 3 {
		t.Fatalf("expected total_tokens=3, got %#v", usageMap)
	}
}
