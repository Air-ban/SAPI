package handlers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"sapi/logging"
	"sapi/middleware"
	"sapi/models"
	"sapi/proxy"
	"sapi/utils"
)

func MountProxyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /chat/completions", handleProxyToProvider)
	mux.HandleFunc("POST /responses", handleResponsesProxyHandler)
	mux.HandleFunc("POST /v1/responses", handleResponsesProxyHandler)
	mux.HandleFunc("GET /responses/", handleProxyToProvider)
	mux.HandleFunc("POST /responses/", handleProxyToProvider)
	mux.HandleFunc("DELETE /responses/", handleProxyToProvider)
	mux.HandleFunc("GET /v1/responses/", handleProxyToProvider)
	mux.HandleFunc("POST /v1/responses/", handleProxyToProvider)
	mux.HandleFunc("DELETE /v1/responses/", handleProxyToProvider)
	mux.HandleFunc("POST /messages/count_tokens", handleAnthropicCountTokensHandler)
	mux.HandleFunc("POST /v1/messages/count_tokens", handleAnthropicCountTokensHandler)
	mux.HandleFunc("POST /messages", handleAnthropicMessagesProxyHandler)
	mux.HandleFunc("POST /v1/messages", handleAnthropicMessagesProxyHandler)
	mux.HandleFunc("GET /v1/", handleProxyToProvider)
	mux.HandleFunc("POST /v1/", handleProxyToProvider)
	mux.HandleFunc("PUT /v1/", handleProxyToProvider)
	mux.HandleFunc("PATCH /v1/", handleProxyToProvider)
	mux.HandleFunc("DELETE /v1/", handleProxyToProvider)
}

func maskKeyPreview(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 12 {
		return key[:min(6, len(key))] + "..."
	}
	return key[:12] + "..." + key[len(key)-min(6, len(key)-12):]
}

type apiKeyInfo struct {
	User         *models.User
	APIKeyRecord *models.APIKeyRecord
	DB           *models.Database
}

func validateProxyRequest(w http.ResponseWriter, r *http.Request) (*apiKeyInfo, bool) {
	if allowed, retryAfter := middleware.CheckAPIKeyFailureLimit(r); !allowed {
		if retryAfter < time.Second {
			retryAfter = time.Second
		}
		w.Header().Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())))
		utils.SendError(w, 429, "Too many failed API key attempts. Try again later.", "api_key_rate_limited")
		return nil, false
	}

	apiKey := utils.GetUserAPIKey(r)
	if apiKey == "" {
		middleware.RecordAPIKeyFailure(r)
		utils.SendError(w, 401, "SAPI API key is required.", "missing_api_key")
		return nil, false
	}

	result := middleware.FindUserByKey(apiKey)
	if result.User == nil {
		middleware.RecordAPIKeyFailure(r)
		utils.SendError(w, 401, "Invalid or disabled SAPI API key.", "invalid_api_key")
		return nil, false
	}
	middleware.ClearAPIKeyFailures(r)
	if result.Banned {
		sendAPIKeyBannedError(w, result.RetryAfter, result.BanReason)
		return nil, false
	}

	if middleware.CheckMaintenanceMode(result.DB, w) {
		return nil, false
	}

	info := &apiKeyInfo{
		User:         result.User,
		APIKeyRecord: result.APIKeyRecord,
		DB:           result.DB,
	}

	model, ok := extractProxyModel(w, r, info)
	if !ok {
		return nil, false
	}

	if model != "" && info.APIKeyRecord != nil && len(info.APIKeyRecord.AllowedModels) > 0 {
		allowed := false
		for _, am := range info.APIKeyRecord.AllowedModels {
			if proxy.IsModelAllowedByRule(am, model) {
				allowed = true
				break
			}
		}
		if !allowed {
			utils.SendError(w, 403, fmt.Sprintf("Model \"%s\" is not allowed for this API key.", model), "model_not_allowed")
			return nil, false
		}
	}

	allowed, limit, current := middleware.CheckRPMLimit(info.User, info.APIKeyRecord, info.DB)
	if !allowed {
		utils.SendError(w, 429, fmt.Sprintf("Rate limit exceeded: %d/%d RPM.", current, limit), "rate_limit_exceeded")
		return nil, false
	}

	return info, true
}

func sendAPIKeyBannedError(w http.ResponseWriter, retryAfter time.Duration, reason string) {
	if retryAfter < time.Second {
		retryAfter = time.Second
	}
	w.Header().Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())))
	message := "API key is temporarily banned. Try again later."
	if reason == "invalid_request_body" {
		message = "API key is temporarily banned for repeated invalid request bodies. Try again later."
	}
	utils.SendError(w, http.StatusTooManyRequests, message, "api_key_banned")
}

func sendInvalidProxyBodyError(w http.ResponseWriter, info *apiKeyInfo, status int, message, code string) {
	if info != nil && info.APIKeyRecord != nil && info.APIKeyRecord.Key != "" {
		banned, retryAfter, _ := middleware.RecordInvalidRequestBody(info.APIKeyRecord.Key)
		if banned {
			sendAPIKeyBannedError(w, retryAfter, "invalid_request_body")
			return
		}
	}
	utils.SendError(w, status, message, code)
}

func recordInvalidProxyBody(w http.ResponseWriter, info *apiKeyInfo) bool {
	if info == nil || info.APIKeyRecord == nil || info.APIKeyRecord.Key == "" {
		return false
	}
	banned, retryAfter, _ := middleware.RecordInvalidRequestBody(info.APIKeyRecord.Key)
	if banned {
		sendAPIKeyBannedError(w, retryAfter, "invalid_request_body")
		return true
	}
	return false
}

func extractProxyModel(w http.ResponseWriter, r *http.Request, info *apiKeyInfo) (string, bool) {
	if r.Body == nil {
		return "", true
	}
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		sendInvalidProxyBodyError(w, info, 400, "Request body could not be read.", "invalid_request")
		return "", false
	}
	r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	if len(bytes.TrimSpace(bodyBytes)) == 0 {
		return "", true
	}
	model, err := extractModelFromBodyBytes(bodyBytes, r.Header.Get("Content-Type"))
	if err != nil {
		sendInvalidProxyBodyError(w, info, 400, err.Error(), "invalid_request")
		return "", false
	}
	if len(model) > 200 {
		sendInvalidProxyBodyError(w, info, 400, "Model name is too long.", "invalid_model")
		return "", false
	}
	return model, true
}

func extractModelFromBodyBytes(bodyBytes []byte, contentType string) (string, error) {
	trimmed := bytes.TrimSpace(bodyBytes)
	if len(trimmed) == 0 {
		return "", nil
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
		params = map[string]string{}
	}
	mediaType = strings.ToLower(mediaType)

	if mediaType == "" && (trimmed[0] == '{' || trimmed[0] == '[') {
		mediaType = "application/json"
	}

	switch mediaType {
	case "application/json", "application/vnd.openai+json":
		var body map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &body); err != nil {
			return "", fmt.Errorf("Request body must be valid JSON.")
		}
		model, _ := body["model"].(string)
		return strings.TrimSpace(model), nil
	case "application/x-www-form-urlencoded":
		values, err := url.ParseQuery(string(bodyBytes))
		if err != nil {
			return "", fmt.Errorf("Request form body is invalid.")
		}
		return strings.TrimSpace(values.Get("model")), nil
	case "multipart/form-data":
		boundary := params["boundary"]
		if boundary == "" {
			return "", fmt.Errorf("Multipart request is missing a boundary.")
		}
		model, err := extractMultipartModel(bodyBytes, boundary)
		if err != nil {
			return "", fmt.Errorf("Multipart request body is invalid.")
		}
		return strings.TrimSpace(model), nil
	default:
		return "", nil
	}
}

func extractMultipartModel(bodyBytes []byte, boundary string) (string, error) {
	reader := multipart.NewReader(bytes.NewReader(bodyBytes), boundary)
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		if part.FormName() != "model" {
			continue
		}
		raw, err := io.ReadAll(io.LimitReader(part, 512))
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(raw)), nil
	}
}

func requestBodyLooksJSON(contentType string, bodyBytes []byte) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err == nil {
		mediaType = strings.ToLower(mediaType)
		return mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
	}
	trimmed := bytes.TrimSpace(bodyBytes)
	return len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[')
}

func cloneRequestContent(body map[string]interface{}) map[string]interface{} {
	if body == nil {
		return nil
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil
	}
	var cloned map[string]interface{}
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return nil
	}
	return cloned
}

func responsesInputFromBody(body map[string]interface{}) interface{} {
	if body == nil {
		return nil
	}
	if input, ok := body["input"]; ok {
		return input
	}
	return body["messages"]
}

func handleResponsesProxyHandler(w http.ResponseWriter, r *http.Request) {
	info, ok := validateProxyRequest(w, r)
	if !ok {
		return
	}

	bodyBytes, _ := io.ReadAll(r.Body)
	var body map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		sendInvalidProxyBodyError(w, info, 400, "Request body must be valid JSON.", "invalid_json")
		return
	}
	requestContent := cloneRequestContent(body)
	customToolNames := proxy.ResponsesCustomToolNames(body["tools"])

	responseRequest := proxy.ConvertToChatCompletionsPayload(body)
	payload, _ := responseRequest["model"]
	model := fmt.Sprintf("%v", payload)

	stream := true
	if s, ok := body["stream"].(bool); ok {
		stream = s
	}

	candidates := proxy.ChooseProviderCandidates(info.DB, responseRequest)
	if len(candidates) == 0 {
		utils.SendError(w, 503, "No enabled upstream provider is configured.", "no_provider")
		return
	}

	if shouldUseNativeResponses(candidates, body) {
		handleNativeResponsesProxy(w, r, info, body, requestContent, candidates, model, stream)
		return
	}

	var selectedProvider *proxy.ProviderCandidate
	var selectedUpstreamReq proxy.ChatCompletionsUpstreamRequest
	var upstreamResp *http.Response
	var lastError error
	startedAt := time.Now()

	for i := range candidates {
		candidate := &candidates[i]
		startedAt = time.Now()

		upstreamReq, err := proxy.BuildChatCompletionsUpstreamRequestDetailed(
			candidate.Provider,
			"/v1/chat/completions",
			"",
			responseRequest,
			candidate.UpstreamModel,
		)
		if err != nil {
			lastError = err
			continue
		}

		req, err := http.NewRequestWithContext(r.Context(), "POST", upstreamReq.URL, bytes.NewReader(upstreamReq.Body))
		if err != nil {
			lastError = err
			continue
		}
		for key, values := range upstreamReq.Headers {
			for _, v := range values {
				req.Header.Add(key, v)
			}
		}
		if accept := r.Header.Get("Accept"); accept != "" && req.Header.Get("Accept") == "" {
			req.Header.Set("Accept", accept)
		}

		resp, err := proxy.DoUpstream(req)
		if err != nil {
			proxy.RecordProviderFailure(candidate.Provider.ID)
			lastError = err
			continue
		}

		if !isOK(resp.StatusCode) && proxy.IsUpstreamProviderError(resp.StatusCode) {
			logging.RecordRequestLog(logging.RequestLogParams{
				UserID:         info.User.ID,
				UserName:       info.User.Name,
				Username:       info.User.Username,
				APIKeyID:       getKeyID(info.APIKeyRecord),
				APIKeyName:     getKeyName(info.APIKeyRecord),
				APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
				ProviderID:     candidate.Provider.ID,
				ProviderName:   candidate.Provider.Name,
				Model:          model,
				UpstreamModel:  candidate.UpstreamModel,
				Endpoint:       "/responses",
				Method:         "POST",
				Status:         resp.StatusCode,
				OK:             false,
				Stream:         stream,
				DurationMs:     int(time.Since(startedAt).Milliseconds()),
				RequestContent: requestContent,
			})
			proxy.RecordProviderFailure(candidate.Provider.ID)
			resp.Body.Close()
			lastError = fmt.Errorf("upstream provider responded with HTTP %d", resp.StatusCode)
			continue
		}

		if !isOK(resp.StatusCode) {
			proxy.RelayUpstreamResponse(resp, w)
			resp.Body.Close()
			return
		}

		selectedProvider = candidate
		selectedUpstreamReq = upstreamReq
		upstreamResp = resp
		break
	}

	if selectedProvider == nil {
		msg := "All upstream providers failed."
		if lastError != nil {
			msg = "All upstream providers failed. Last error: " + lastError.Error()
		}
		utils.SendError(w, 502, msg, "upstream_request_failed")
		return
	}

	provider := selectedProvider
	defer upstreamResp.Body.Close()

	if !stream {
		bodyBytes, _ := io.ReadAll(upstreamResp.Body)
		var payload map[string]interface{}
		json.Unmarshal(bodyBytes, &payload)
		payload = upstreamChatPayloadAsOpenAI(payload, selectedUpstreamReq.Kind, model)

		text, finishReason, usage := proxy.ExtractChatCompletionText(payload)
		instructions, _ := body["instructions"].(string)
		input := responsesInputFromBody(body)

		outputItems := make([]interface{}, 0)
		reasoningEffort, _ := body["reasoning"].(map[string]interface{})
		effort := ""
		if reasoningEffort != nil {
			effort, _ = reasoningEffort["effort"].(string)
		}
		if effort != "" {
			outputItems = append(outputItems, proxy.CreateReasoningItem(effort))
		}
		toolItems := proxy.ExtractChatCompletionToolCallItems(payload, customToolNames)
		if text != "" || len(toolItems) == 0 {
			outputItems = append(outputItems, proxy.CreateAssistantMessageItem(text))
		}
		outputItems = append(outputItems, toolItems...)

		respObj := proxy.BuildResponseObject(map[string]interface{}{
			"status":          "completed",
			"model":           model,
			"input":           input,
			"instructions":    instructions,
			"output":          outputItems,
			"outputText":      text,
			"usage":           usage,
			"reasoningEffort": effort,
			"finishReason":    finishReason,
		})

		logging.RecordRequestLog(logging.RequestLogParams{
			UserID:         info.User.ID,
			UserName:       info.User.Name,
			Username:       info.User.Username,
			APIKeyID:       getKeyID(info.APIKeyRecord),
			APIKeyName:     getKeyName(info.APIKeyRecord),
			APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
			ProviderID:     provider.Provider.ID,
			ProviderName:   provider.Provider.Name,
			Model:          model,
			UpstreamModel:  provider.UpstreamModel,
			Endpoint:       "/responses",
			Method:         "POST",
			Status:         200,
			OK:             true,
			Stream:         false,
			DurationMs:     int(time.Since(startedAt).Milliseconds()),
			Usage:          usage,
			RequestContent: requestContent,
		})
		proxy.RecordProviderSuccess(provider.Provider.ID)

		w.WriteHeader(200)
		json.NewEncoder(w).Encode(respObj)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(200)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	sseWriter := proxy.CreateSseWriter(w)
	responseID := utils.GenerateID("resp")
	messageID := utils.GenerateID("msg")

	reasoningEffort, _ := body["reasoning"].(map[string]interface{})
	effort := ""
	if reasoningEffort != nil {
		effort, _ = reasoningEffort["effort"].(string)
	}
	reasoningIdx := -1
	if effort != "" {
		reasoningIdx = 0
	}

	instructions, _ := body["instructions"].(string)
	input := responsesInputFromBody(body)

	outputItems := make([]interface{}, 0)
	if effort != "" {
		outputItems = append(outputItems, proxy.CreateReasoningItem(effort))
	}
	assistantItem := map[string]interface{}{
		"id":      messageID,
		"type":    "message",
		"status":  "in_progress",
		"content": []interface{}{},
		"phase":   "final_answer",
		"role":    "assistant",
	}
	outputItems = append(outputItems, assistantItem)

	baseResponse := proxy.BuildResponseObject(map[string]interface{}{
		"status":          "in_progress",
		"model":           model,
		"input":           input,
		"instructions":    instructions,
		"output":          outputItems,
		"outputText":      "",
		"usage":           nil,
		"reasoningEffort": effort,
	})
	baseResponse["id"] = responseID

	sseWriter.Write("response.created", map[string]interface{}{"response": baseResponse})
	sseWriter.Write("response.in_progress", map[string]interface{}{"response": baseResponse})

	if effort != "" {
		reasoningItem := proxy.CreateReasoningItem(effort)
		sseWriter.Write("response.output_item.added", map[string]interface{}{
			"item":         reasoningItem,
			"output_index": 0,
		})
		sseWriter.Write("response.output_item.done", map[string]interface{}{
			"item":         reasoningItem,
			"output_index": 0,
		})
	}

	assistIdx := 0
	if reasoningIdx >= 0 {
		assistIdx = 1
	}
	sseWriter.Write("response.output_item.added", map[string]interface{}{
		"item":         assistantItem,
		"output_index": assistIdx,
	})

	contentPart := map[string]interface{}{
		"type":        "output_text",
		"annotations": []interface{}{},
		"logprobs":    []interface{}{},
		"text":        "",
	}
	sseWriter.Write("response.content_part.added", map[string]interface{}{
		"content_index": 0,
		"item_id":       messageID,
		"output_index":  assistIdx,
		"part":          contentPart,
	})

	reader := bufio.NewReader(upstreamResp.Body)
	var buf strings.Builder
	outputText := ""
	finishReason := ""
	var usagePayload interface{}
	toolAccumulator := proxy.NewChatToolCallAccumulator()

	for {
		line, err := readLine(reader, &buf)
		if err != nil {
			break
		}
		line = upstreamStreamLineAsOpenAI(line, selectedUpstreamReq.Kind, model)
		if line == "" {
			continue
		}

		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, ":") {
			continue
		}

		item := trimmed
		if strings.HasPrefix(trimmed, "data:") {
			item = strings.TrimSpace(trimmed[5:])
		}
		if item == "" || item == "[DONE]" || (!strings.HasPrefix(item, "{") && !strings.HasPrefix(item, "[")) {
			continue
		}

		var ssePayload map[string]interface{}
		if json.Unmarshal([]byte(item), &ssePayload) != nil {
			continue
		}
		toolAccumulator.AddChunk(ssePayload)

		dText, dFinish, dUsage := proxy.ExtractChatCompletionText(ssePayload)
		if dFinish != "" {
			finishReason = dFinish
		}
		if dUsage != nil {
			usagePayload = dUsage
		}

		if dText != "" {
			outputText += dText
			sseWriter.Write("response.output_text.delta", map[string]interface{}{
				"content_index": 0,
				"delta":         dText,
				"item_id":       messageID,
				"output_index":  assistIdx,
			})
		}
	}

	completedItem := map[string]interface{}{
		"id":     messageID,
		"type":   "message",
		"status": "completed",
		"content": []interface{}{
			map[string]interface{}{
				"type":        "output_text",
				"annotations": []interface{}{},
				"logprobs":    []interface{}{},
				"text":        outputText,
			},
		},
		"phase": "final_answer",
		"role":  "assistant",
	}

	finalOutput := make([]interface{}, 0)
	if effort != "" {
		finalOutput = append(finalOutput, proxy.CreateReasoningItem(effort))
	}
	finalOutput = append(finalOutput, completedItem)
	toolItems := toolAccumulator.Items(customToolNames)
	finalOutput = append(finalOutput, toolItems...)

	sseWriter.Write("response.output_text.done", map[string]interface{}{
		"content_index": 0,
		"item_id":       messageID,
		"output_index":  assistIdx,
		"logprobs":      []interface{}{},
		"text":          outputText,
	})
	sseWriter.Write("response.content_part.done", map[string]interface{}{
		"content_index": 0,
		"item_id":       messageID,
		"output_index":  assistIdx,
		"part": map[string]interface{}{
			"type":        "output_text",
			"annotations": []interface{}{},
			"logprobs":    []interface{}{},
			"text":        outputText,
		},
	})
	sseWriter.Write("response.output_item.done", map[string]interface{}{
		"item":         completedItem,
		"output_index": assistIdx,
	})
	toolStartIndex := assistIdx + 1
	for i, item := range toolItems {
		outputIndex := toolStartIndex + i
		sseWriter.Write("response.output_item.added", map[string]interface{}{
			"item":         item,
			"output_index": outputIndex,
		})
		sseWriter.Write("response.output_item.done", map[string]interface{}{
			"item":         item,
			"output_index": outputIndex,
		})
	}

	finalResponse := proxy.BuildResponseObject(map[string]interface{}{
		"status":          "completed",
		"model":           model,
		"input":           input,
		"instructions":    instructions,
		"output":          finalOutput,
		"outputText":      outputText,
		"usage":           usagePayload,
		"reasoningEffort": effort,
		"finishReason":    finishReason,
	})
	finalResponse["id"] = responseID

	sseWriter.Write("response.completed", map[string]interface{}{"response": finalResponse})

	logging.RecordRequestLog(logging.RequestLogParams{
		UserID:         info.User.ID,
		UserName:       info.User.Name,
		Username:       info.User.Username,
		APIKeyID:       getKeyID(info.APIKeyRecord),
		APIKeyName:     getKeyName(info.APIKeyRecord),
		APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
		ProviderID:     provider.Provider.ID,
		ProviderName:   provider.Provider.Name,
		Model:          model,
		UpstreamModel:  provider.UpstreamModel,
		Endpoint:       "/responses",
		Method:         "POST",
		Status:         200,
		OK:             true,
		Stream:         true,
		DurationMs:     int(time.Since(startedAt).Milliseconds()),
		Usage:          usagePayload,
		RequestContent: requestContent,
	})
	proxy.RecordProviderSuccess(provider.Provider.ID)
}

func shouldUseNativeResponses(candidates []proxy.ProviderCandidate, body map[string]interface{}) bool {
	for _, candidate := range candidates {
		if proxy.ShouldUseNativeResponses(candidate.Provider, body) {
			return true
		}
	}
	return false
}

func handleNativeResponsesProxy(w http.ResponseWriter, r *http.Request, info *apiKeyInfo, body map[string]interface{}, requestContent map[string]interface{}, candidates []proxy.ProviderCandidate, model string, stream bool) {
	var lastError error

	for i := range candidates {
		candidate := &candidates[i]
		if proxy.ProviderUpstreamKind(candidate.Provider) != proxy.UpstreamOpenAI {
			continue
		}
		startedAt := time.Now()
		upstreamReq, err := proxy.BuildOpenAIJSONUpstreamRequestDetailed(
			candidate.Provider,
			"/v1/responses",
			r.URL.RawQuery,
			body,
			candidate.UpstreamModel,
		)
		if err != nil {
			lastError = err
			continue
		}

		req, err := http.NewRequestWithContext(r.Context(), "POST", upstreamReq.URL, bytes.NewReader(upstreamReq.Body))
		if err != nil {
			lastError = err
			continue
		}
		for key, values := range upstreamReq.Headers {
			for _, v := range values {
				req.Header.Add(key, v)
			}
		}
		if accept := r.Header.Get("Accept"); accept != "" {
			req.Header.Set("Accept", accept)
		}

		resp, err := proxy.DoUpstream(req)
		if err != nil {
			proxy.RecordProviderFailure(candidate.Provider.ID)
			lastError = err
			continue
		}

		if !isOK(resp.StatusCode) && proxy.IsUpstreamProviderError(resp.StatusCode) {
			logging.RecordRequestLog(logging.RequestLogParams{
				UserID:         info.User.ID,
				UserName:       info.User.Name,
				Username:       info.User.Username,
				APIKeyID:       getKeyID(info.APIKeyRecord),
				APIKeyName:     getKeyName(info.APIKeyRecord),
				APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
				ProviderID:     candidate.Provider.ID,
				ProviderName:   candidate.Provider.Name,
				Model:          model,
				UpstreamModel:  candidate.UpstreamModel,
				Endpoint:       "/responses",
				Method:         "POST",
				Status:         resp.StatusCode,
				OK:             false,
				Stream:         stream,
				DurationMs:     int(time.Since(startedAt).Milliseconds()),
				RequestContent: requestContent,
			})
			proxy.RecordProviderFailure(candidate.Provider.ID)
			resp.Body.Close()
			lastError = fmt.Errorf("upstream provider responded with HTTP %d", resp.StatusCode)
			continue
		}

		if !isOK(resp.StatusCode) {
			proxy.RelayUpstreamResponse(resp, w)
			resp.Body.Close()
			return
		}

		utils.CopyUpstreamHeaders(resp.Header, w, nil)
		w.WriteHeader(resp.StatusCode)
		var usage interface{}
		if utils.ShouldStreamResponse(r, resp) || stream {
			usage = proxy.WriteUpstreamStreamToResponse(resp, w)
		} else {
			bodyBytes, _ := io.ReadAll(resp.Body)
			usage = utils.ExtractUsageFromResponseText(string(bodyBytes))
			w.Write(bodyBytes)
		}
		resp.Body.Close()

		logging.RecordRequestLog(logging.RequestLogParams{
			UserID:         info.User.ID,
			UserName:       info.User.Name,
			Username:       info.User.Username,
			APIKeyID:       getKeyID(info.APIKeyRecord),
			APIKeyName:     getKeyName(info.APIKeyRecord),
			APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
			ProviderID:     candidate.Provider.ID,
			ProviderName:   candidate.Provider.Name,
			Model:          model,
			UpstreamModel:  candidate.UpstreamModel,
			Endpoint:       "/responses",
			Method:         "POST",
			Status:         resp.StatusCode,
			OK:             true,
			Stream:         stream,
			DurationMs:     int(time.Since(startedAt).Milliseconds()),
			Usage:          usage,
			RequestContent: requestContent,
		})
		proxy.RecordProviderSuccess(candidate.Provider.ID)
		return
	}

	msg := "No OpenAI-compatible upstream provider is available for native Responses features."
	if lastError != nil {
		msg += " Last error: " + lastError.Error()
	}
	utils.SendError(w, 502, msg, "native_responses_unavailable")
}

func handleAnthropicCountTokensHandler(w http.ResponseWriter, r *http.Request) {
	info, ok := validateProxyRequest(w, r)
	if !ok {
		return
	}

	bodyBytes, _ := io.ReadAll(r.Body)
	var body map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		sendInvalidProxyBodyError(w, info, 400, "Request body must be valid JSON.", "invalid_json")
		return
	}
	requestContent := cloneRequestContent(body)

	inputTokens := proxy.EstimateAnthropicInputTokens(body)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"input_tokens": inputTokens,
	})
	model, _ := body["model"].(string)
	logging.RecordRequestLog(logging.RequestLogParams{
		UserID:         info.User.ID,
		UserName:       info.User.Name,
		Username:       info.User.Username,
		APIKeyID:       getKeyID(info.APIKeyRecord),
		APIKeyName:     getKeyName(info.APIKeyRecord),
		APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
		Model:          model,
		Endpoint:       r.URL.Path,
		Method:         r.Method,
		Status:         200,
		OK:             true,
		Stream:         false,
		Usage:          map[string]interface{}{"input_tokens": float64(inputTokens)},
		RequestContent: requestContent,
	})
	_ = info
}

func handleAnthropicMessagesProxyHandler(w http.ResponseWriter, r *http.Request) {
	info, ok := validateProxyRequest(w, r)
	if !ok {
		return
	}

	bodyBytes, _ := io.ReadAll(r.Body)
	var body map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		if recordInvalidProxyBody(w, info) {
			return
		}
		proxy.SendAnthropicError(w, 400, "invalid_request_error", "Request body must be valid JSON.")
		return
	}
	requestContent := cloneRequestContent(body)

	model, _ := body["model"].(string)
	if len(model) > 200 {
		if recordInvalidProxyBody(w, info) {
			return
		}
		proxy.SendAnthropicError(w, 400, "invalid_request_error", "Model name is too long.")
		return
	}
	openAIBody := proxy.AnthropicToOpenAI(body)
	openAIBody["model"] = model
	wantStream, _ := openAIBody["stream"].(bool)

	candidates := proxy.ChooseAnthropicProviderCandidates(info.DB, model)
	if len(candidates) == 0 {
		proxy.SendAnthropicError(w, 503, "api_error", "No enabled upstream provider is configured.")
		return
	}

	var selectedProvider *proxy.ProviderCandidate
	var selectedUpstreamReq proxy.ChatCompletionsUpstreamRequest
	var selectedUpstreamModel string
	var upstreamResp *http.Response
	var lastError error
	startedAt := time.Now()

	for i := range candidates {
		candidate := &candidates[i]
		startedAt = time.Now()
		upstreamModelForLog := candidate.UpstreamModel
		if upstreamModelForLog == "" {
			upstreamModelForLog = model
		}

		upstreamReq, err := buildAnthropicMessagesUpstreamRequest(
			candidate.Provider,
			body,
			openAIBody,
			candidate.UpstreamModel,
		)
		if err != nil {
			lastError = err
			continue
		}

		req, err := http.NewRequestWithContext(r.Context(), "POST", upstreamReq.URL, bytes.NewReader(upstreamReq.Body))
		if err != nil {
			lastError = err
			continue
		}
		for key, values := range upstreamReq.Headers {
			for _, v := range values {
				req.Header.Add(key, v)
			}
		}

		resp, err := proxy.DoUpstream(req)
		if err != nil {
			proxy.RecordProviderFailure(candidate.Provider.ID)
			lastError = err
			continue
		}

		if !isOK(resp.StatusCode) && proxy.IsUpstreamProviderError(resp.StatusCode) {
			logging.RecordRequestLog(logging.RequestLogParams{
				UserID:         info.User.ID,
				UserName:       info.User.Name,
				Username:       info.User.Username,
				APIKeyID:       getKeyID(info.APIKeyRecord),
				APIKeyName:     getKeyName(info.APIKeyRecord),
				APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
				ProviderID:     candidate.Provider.ID,
				ProviderName:   candidate.Provider.Name,
				Model:          model,
				UpstreamModel:  upstreamModelForLog,
				Endpoint:       "/v1/messages",
				Method:         "POST",
				Status:         resp.StatusCode,
				OK:             false,
				Stream:         wantStream,
				DurationMs:     int(time.Since(startedAt).Milliseconds()),
				RequestContent: requestContent,
			})
			proxy.RecordProviderFailure(candidate.Provider.ID)
			resp.Body.Close()
			lastError = fmt.Errorf("upstream provider responded with HTTP %d", resp.StatusCode)
			continue
		}

		if !isOK(resp.StatusCode) {
			bodyBytes, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			var errPayload map[string]interface{}
			json.Unmarshal(bodyBytes, &errPayload)
			errMsg := "Upstream provider error."
			if errData, ok := errPayload["error"].(map[string]interface{}); ok {
				if msg, ok := errData["message"].(string); ok {
					errMsg = msg
				}
			}
			proxy.SendAnthropicError(w, resp.StatusCode, "api_error", errMsg)
			return
		}

		selectedProvider = candidate
		selectedUpstreamReq = upstreamReq
		selectedUpstreamModel = upstreamModelForLog
		upstreamResp = resp
		break
	}

	if selectedProvider == nil {
		msg := "All upstream providers failed."
		if lastError != nil {
			msg = "All upstream providers failed. Last error: " + lastError.Error()
		}
		proxy.SendAnthropicError(w, 502, "api_error", msg)
		return
	}

	provider := selectedProvider
	defer upstreamResp.Body.Close()

	if !wantStream {
		bodyBytes, _ := io.ReadAll(upstreamResp.Body)
		var payload map[string]interface{}
		json.Unmarshal(bodyBytes, &payload)

		usage := utils.FindUsagePayload(payload)
		anthropicResp := payload
		if selectedUpstreamReq.NeedsChatResponseConversion || selectedUpstreamReq.Kind != proxy.UpstreamAnthropic {
			openAIChatPayload := upstreamChatPayloadAsOpenAI(payload, selectedUpstreamReq.Kind, model)
			anthropicResp = proxy.OpenAIToAnthropicNonStreaming(openAIChatPayload, model)
			usage = utils.FindUsagePayload(openAIChatPayload)
		} else if anthropicResp == nil {
			anthropicResp = map[string]interface{}{}
		}
		if model != "" {
			anthropicResp["model"] = model
		}

		w.Header().Set("Anthropic-Version", "2023-06-01")
		w.WriteHeader(200)
		json.NewEncoder(w).Encode(anthropicResp)

		logging.RecordRequestLog(logging.RequestLogParams{
			UserID:         info.User.ID,
			UserName:       info.User.Name,
			Username:       info.User.Username,
			APIKeyID:       getKeyID(info.APIKeyRecord),
			APIKeyName:     getKeyName(info.APIKeyRecord),
			APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
			ProviderID:     provider.Provider.ID,
			ProviderName:   provider.Provider.Name,
			Model:          model,
			UpstreamModel:  selectedUpstreamModel,
			Endpoint:       "/v1/messages",
			Method:         "POST",
			Status:         200,
			OK:             true,
			Stream:         false,
			DurationMs:     int(time.Since(startedAt).Milliseconds()),
			Usage:          usage,
			RequestContent: requestContent,
		})
		proxy.RecordProviderSuccess(provider.Provider.ID)
		return
	}

	if selectedUpstreamReq.Kind == proxy.UpstreamAnthropic && !selectedUpstreamReq.NeedsChatResponseConversion {
		utils.CopyUpstreamHeaders(upstreamResp.Header, w, map[string]string{
			"Content-Type":      "text/event-stream; charset=utf-8",
			"Cache-Control":     "no-cache, no-transform",
			"X-Accel-Buffering": "no",
			"Anthropic-Version": "2023-06-01",
		})
		w.WriteHeader(200)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		usage := proxy.WriteUpstreamStreamToResponse(upstreamResp, w)
		logging.RecordRequestLog(logging.RequestLogParams{
			UserID:         info.User.ID,
			UserName:       info.User.Name,
			Username:       info.User.Username,
			APIKeyID:       getKeyID(info.APIKeyRecord),
			APIKeyName:     getKeyName(info.APIKeyRecord),
			APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
			ProviderID:     provider.Provider.ID,
			ProviderName:   provider.Provider.Name,
			Model:          model,
			UpstreamModel:  selectedUpstreamModel,
			Endpoint:       "/v1/messages",
			Method:         "POST",
			Status:         200,
			OK:             true,
			Stream:         true,
			DurationMs:     int(time.Since(startedAt).Milliseconds()),
			Usage:          usage,
			RequestContent: requestContent,
		})
		proxy.RecordProviderSuccess(provider.Provider.ID)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Anthropic-Version", "2023-06-01")
	w.WriteHeader(200)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	writeEvent := func(eventType string, data interface{}) {
		jsonData, _ := json.Marshal(data)
		fmt.Fprintf(w, "event: %s\n", eventType)
		fmt.Fprintf(w, "data: %s\n\n", string(jsonData))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}

	responseID := utils.GenerateID("msg")
	writeEvent("message_start", map[string]interface{}{
		"type": "message_start",
		"message": map[string]interface{}{
			"id":            responseID,
			"type":          "message",
			"role":          "assistant",
			"content":       []interface{}{},
			"model":         model,
			"stop_reason":   nil,
			"stop_sequence": nil,
			"usage": map[string]interface{}{
				"input_tokens":                0,
				"output_tokens":               0,
				"cache_creation_input_tokens": 0,
				"cache_read_input_tokens":     0,
			},
		},
	})

	reader := bufio.NewReader(upstreamResp.Body)
	var buf strings.Builder
	var outputText string
	var finishReason string
	var usagePayload interface{}
	nextContentIndex := 0
	thinkingBlockIndex := -1
	textBlockIndex := -1
	toolIndexMap := map[int]int{}
	toolArgBuffers := map[int]string{}

	for {
		line, err := readLine(reader, &buf)
		if err != nil {
			break
		}
		line = upstreamStreamLineAsOpenAI(line, selectedUpstreamReq.Kind, model)
		if line == "" {
			continue
		}

		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, ":") {
			continue
		}

		item := trimmed
		if strings.HasPrefix(trimmed, "data:") {
			item = strings.TrimSpace(trimmed[5:])
		}
		if item == "" || item == "[DONE]" || (!strings.HasPrefix(item, "{") && !strings.HasPrefix(item, "[")) {
			continue
		}

		var ssePayload map[string]interface{}
		if json.Unmarshal([]byte(item), &ssePayload) != nil {
			continue
		}

		_, dFinish, dUsage := proxy.ExtractChatCompletionText(ssePayload)
		if dFinish != "" {
			choices, _ := ssePayload["choices"].([]interface{})
			if len(choices) > 0 {
				choice, _ := choices[0].(map[string]interface{})
				delta, _ := choice["delta"].(map[string]interface{})
				if delta != nil {
					hasContent := (delta["content"] != nil && delta["content"] != "") ||
						(len(getToolCalls(delta)) > 0) ||
						(delta["reasoning_content"] != nil && delta["reasoning_content"] != "")
					if !hasContent {
						finishReason = dFinish
					}
				}
			}
		}
		if dUsage != nil {
			usagePayload = dUsage
		}

		events := proxy.OpenAIToAnthropicDeltaStreaming(ssePayload)
		for _, ev := range events {
			if toolStart, _ := ev["_toolStart"].(bool); toolStart {
				upIdx := 0
				if idx, ok := ev["_upstreamIndex"].(float64); ok {
					upIdx = int(idx)
				}
				if _, exists := toolIndexMap[upIdx]; !exists {
					outIdx := nextContentIndex
					nextContentIndex++
					toolIndexMap[upIdx] = outIdx
					toolArgBuffers[upIdx] = ""
					writeEvent("content_block_start", map[string]interface{}{
						"type":          "content_block_start",
						"index":         outIdx,
						"content_block": ev["content_block"],
					})
				}
			} else if delta, ok := ev["delta"].(map[string]interface{}); ok {
				deltaType, _ := delta["type"].(string)
				upIdx := 0
				if idx, ok := ev["_upstreamIndex"].(float64); ok {
					upIdx = int(idx)
				}

				switch deltaType {
				case "input_json_delta":
					if outIdx, exists := toolIndexMap[upIdx]; exists {
						partialJSON, _ := delta["partial_json"].(string)
						toolArgBuffers[upIdx] += partialJSON
						writeEvent("content_block_delta", map[string]interface{}{
							"type":  "content_block_delta",
							"index": outIdx,
							"delta": map[string]interface{}{
								"type":         "input_json_delta",
								"partial_json": partialJSON,
							},
						})
					}
				case "thinking_delta":
					if thinkingBlockIndex < 0 {
						thinkingBlockIndex = nextContentIndex
						nextContentIndex++
						writeEvent("content_block_start", map[string]interface{}{
							"type":  "content_block_start",
							"index": thinkingBlockIndex,
							"content_block": map[string]interface{}{
								"type":     "thinking",
								"thinking": "",
							},
						})
					}
					thinking, _ := delta["thinking"].(string)
					writeEvent("content_block_delta", map[string]interface{}{
						"type":  "content_block_delta",
						"index": thinkingBlockIndex,
						"delta": map[string]interface{}{
							"type":     "thinking_delta",
							"thinking": thinking,
						},
					})
				case "text_delta":
					if thinkingBlockIndex >= 0 {
						writeEvent("content_block_stop", map[string]interface{}{
							"type":  "content_block_stop",
							"index": thinkingBlockIndex,
						})
						thinkingBlockIndex = -1
					}
					if textBlockIndex < 0 {
						textBlockIndex = nextContentIndex
						nextContentIndex++
						writeEvent("content_block_start", map[string]interface{}{
							"type":  "content_block_start",
							"index": textBlockIndex,
							"content_block": map[string]interface{}{
								"type": "text",
								"text": "",
							},
						})
					}
					text, _ := delta["text"].(string)
					outputText += text
					writeEvent("content_block_delta", map[string]interface{}{
						"type":  "content_block_delta",
						"index": textBlockIndex,
						"delta": map[string]interface{}{
							"type": "text_delta",
							"text": text,
						},
					})
				}
			}
		}
	}

	for _, outIdx := range toolIndexMap {
		writeEvent("content_block_stop", map[string]interface{}{
			"type":  "content_block_stop",
			"index": outIdx,
		})
	}

	if textBlockIndex >= 0 {
		writeEvent("content_block_stop", map[string]interface{}{
			"type":  "content_block_stop",
			"index": textBlockIndex,
		})
	} else {
		if thinkingBlockIndex >= 0 {
			writeEvent("content_block_stop", map[string]interface{}{
				"type":  "content_block_stop",
				"index": thinkingBlockIndex,
			})
			thinkingBlockIndex = -1
		}
		textIdx := nextContentIndex
		writeEvent("content_block_start", map[string]interface{}{
			"type":  "content_block_start",
			"index": textIdx,
			"content_block": map[string]interface{}{
				"type": "text",
				"text": "",
			},
		})
		writeEvent("content_block_stop", map[string]interface{}{
			"type":  "content_block_stop",
			"index": textIdx,
		})
	}

	stopReason := "end_turn"
	if finishReason == "tool_calls" {
		stopReason = "tool_use"
	} else if finishReason == "length" {
		stopReason = "max_tokens"
	}

	normalized := utils.NormalizeUsage(usagePayload)
	outputTokens := 0
	if normalized != nil {
		outputTokens = normalized.CompletionTokens
	}

	writeEvent("message_delta", map[string]interface{}{
		"type": "message_delta",
		"delta": map[string]interface{}{
			"stop_reason":   stopReason,
			"stop_sequence": nil,
		},
		"usage": map[string]interface{}{
			"output_tokens": outputTokens,
		},
	})
	writeEvent("message_stop", map[string]interface{}{"type": "message_stop"})

	logging.RecordRequestLog(logging.RequestLogParams{
		UserID:         info.User.ID,
		UserName:       info.User.Name,
		Username:       info.User.Username,
		APIKeyID:       getKeyID(info.APIKeyRecord),
		APIKeyName:     getKeyName(info.APIKeyRecord),
		APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
		ProviderID:     provider.Provider.ID,
		ProviderName:   provider.Provider.Name,
		Model:          model,
		UpstreamModel:  selectedUpstreamModel,
		Endpoint:       "/v1/messages",
		Method:         "POST",
		Status:         200,
		OK:             true,
		Stream:         true,
		DurationMs:     int(time.Since(startedAt).Milliseconds()),
		Usage:          usagePayload,
		FinishReason:   finishReason,
		RequestContent: requestContent,
	})
	proxy.RecordProviderSuccess(provider.Provider.ID)
}

func handleProxyToProvider(w http.ResponseWriter, r *http.Request) {
	log.Printf("[V1CHAT] === REQUEST === %s %s | client=%s | content-type=%s | accept=%s",
		r.Method, r.URL.String(), r.RemoteAddr, r.Header.Get("Content-Type"), r.Header.Get("Accept"))

	if r.Method == "GET" && r.URL.Path == "/v1/models" {
		handleModelsList(w, r)
		return
	}

	info, ok := validateProxyRequest(w, r)
	if !ok {
		log.Printf("[V1CHAT] VALIDATE_FAILED path=%s", r.URL.Path)
		return
	}
	log.Printf("[V1CHAT] VALIDATE_OK user=%s(%s) key_id=%s key_name=%s",
		info.User.Name, info.User.ID, getKeyID(info.APIKeyRecord), getKeyName(info.APIKeyRecord))

	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	log.Printf("[V1CHAT] BODY_READ len=%d preview=%s", len(bodyBytes), truncateForLog(string(bodyBytes), 300))

	var body map[string]interface{}
	jsonBody := requestBodyLooksJSON(r.Header.Get("Content-Type"), bodyBytes)
	if jsonBody && len(bytes.TrimSpace(bodyBytes)) > 0 {
		if err := json.Unmarshal(bodyBytes, &body); err != nil {
			sendInvalidProxyBodyError(w, info, 400, "Request body must be valid JSON.", "invalid_json")
			return
		}
	}
	requestContent := cloneRequestContent(body)
	if requestContent == nil && len(bytes.TrimSpace(bodyBytes)) > 0 {
		requestContent = map[string]interface{}{
			"contentType": r.Header.Get("Content-Type"),
			"bodyBytes":   len(bodyBytes),
		}
	}
	model, _ := extractModelFromBodyBytes(bodyBytes, r.Header.Get("Content-Type"))
	if len(model) > 200 {
		sendInvalidProxyBodyError(w, info, 400, "Model name is too long.", "invalid_model")
		return
	}
	isChatCompletionsRequest := isChatCompletionsRequestPath(r.URL.Path)
	if isChatCompletionsRequest && proxy.IsGPTModelID(model) {
		sendGPTChatCompletionsDisabledError(w, model)
		return
	}
	streamReq, _ := body["stream"].(bool)
	log.Printf("[V1CHAT] BODY_PARSE model=%s stream=%v messages=%d", model, streamReq, len(extractMessages(body)))

	routingBody := body
	if routingBody == nil {
		routingBody = map[string]interface{}{}
	}
	if model != "" {
		routingBody["model"] = model
	}
	candidates := proxy.ChooseProviderCandidates(info.DB, routingBody)
	if len(candidates) == 0 {
		log.Printf("[V1CHAT] NO_PROVIDER model=%s", model)
		utils.SendError(w, 503, "No enabled upstream provider is configured.", "no_provider")
		return
	}
	if isChatCompletionsRequest {
		var blocked bool
		candidates, blocked = filterGPTChatCompletionsCandidates(candidates)
		if blocked && len(candidates) == 0 {
			sendGPTChatCompletionsDisabledError(w, model)
			return
		}
	}
	log.Printf("[V1CHAT] PROVIDERS count=%d model=%s", len(candidates), model)
	for i, c := range candidates {
		log.Printf("[V1CHAT]   candidate[%d] provider=%s(%s) base_url=%s upstream_model=%s enabled=%v",
			i, c.Provider.Name, c.Provider.ID, c.Provider.BaseURL, c.UpstreamModel, c.Provider.Enabled)
	}

	var lastError error

	for i := range candidates {
		candidate := &candidates[i]
		startedAt := time.Now()
		log.Printf("[V1CHAT] TRY_CANDIDATE[%d] provider=%s upstream_model=%s",
			i, candidate.Provider.Name, candidate.UpstreamModel)

		var upstreamReq proxy.ChatCompletionsUpstreamRequest
		var err error
		if jsonBody {
			upstreamReq, err = proxy.BuildChatCompletionsUpstreamRequestDetailed(
				candidate.Provider,
				r.URL.Path,
				r.URL.RawQuery,
				body,
				candidate.UpstreamModel,
			)
		} else {
			upstreamReq, err = proxy.BuildOpenAICompatibleUpstreamRequestDetailed(
				candidate.Provider,
				r.URL.Path,
				r.URL.RawQuery,
				bodyBytes,
				r.Header.Get("Content-Type"),
				candidate.UpstreamModel,
			)
		}
		if err != nil {
			log.Printf("[V1CHAT] BUILD_UPSTREAM_REQ_ERROR err=%v", err)
			lastError = err
			continue
		}
		log.Printf("[V1CHAT] UPSTREAM_URL %s %s", r.Method, upstreamReq.URL)

		var reqBody io.Reader
		if upstreamReq.Body != nil {
			reqBody = bytes.NewReader(upstreamReq.Body)
		}
		log.Printf("[V1CHAT] UPSTREAM_BODY len=%d preview=%s",
			len(upstreamReq.Body), truncateForLog(string(upstreamReq.Body), 200))

		req, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamReq.URL, reqBody)
		if err != nil {
			log.Printf("[V1CHAT] CREATE_REQ_ERROR err=%v", err)
			lastError = err
			continue
		}

		forwardHeaders := utils.FilterForwardHeaders(r.Header)
		for key, values := range forwardHeaders {
			for _, v := range values {
				req.Header.Add(key, v)
			}
		}
		for key, values := range upstreamReq.Headers {
			req.Header.Del(key)
			for _, v := range values {
				req.Header.Add(key, v)
			}
		}
		if reqBody != nil && req.Header.Get("Content-Type") == "" {
			req.Header.Set("Content-Type", "application/json")
		}
		log.Printf("[V1CHAT] SEND_UPSTREAM content-type=%s auth_prefix=%s...",
			req.Header.Get("Content-Type"), truncateForLog(candidate.Provider.APIKey, 12))

		resp, err := proxy.DoUpstream(req)
		if err != nil {
			log.Printf("[V1CHAT] UPSTREAM_ERR err=%v", err)
			proxy.RecordProviderFailure(candidate.Provider.ID)
			lastError = err
			continue
		}

		log.Printf("[V1CHAT] UPSTREAM_RESP status=%d content-type=%s content-length=%s",
			resp.StatusCode, resp.Header.Get("Content-Type"), resp.Header.Get("Content-Length"))

		if !isOK(resp.StatusCode) && proxy.IsUpstreamProviderError(resp.StatusCode) {
			log.Printf("[V1CHAT] UPSTREAM_ERROR_5xx status=%d", resp.StatusCode)
			logging.RecordRequestLog(logging.RequestLogParams{
				UserID:         info.User.ID,
				UserName:       info.User.Name,
				Username:       info.User.Username,
				APIKeyID:       getKeyID(info.APIKeyRecord),
				APIKeyName:     getKeyName(info.APIKeyRecord),
				APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
				ProviderID:     candidate.Provider.ID,
				ProviderName:   candidate.Provider.Name,
				Model:          model,
				UpstreamModel:  candidate.UpstreamModel,
				Endpoint:       r.URL.Path,
				Method:         r.Method,
				Status:         resp.StatusCode,
				OK:             false,
				Stream:         false,
				DurationMs:     int(time.Since(startedAt).Milliseconds()),
				RequestContent: requestContent,
			})
			proxy.RecordProviderFailure(candidate.Provider.ID)
			resp.Body.Close()
			lastError = fmt.Errorf("upstream provider responded with HTTP %d", resp.StatusCode)
			continue
		}

		if !isOK(resp.StatusCode) {
			log.Printf("[V1CHAT] UPSTREAM_ERROR_CLIENT status=%d", resp.StatusCode)
			bodyBytes, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			log.Printf("[V1CHAT] ERROR_BODY len=%d preview=%s", len(bodyBytes), truncateForLog(string(bodyBytes), 300))
			utils.CopyUpstreamHeaders(resp.Header, w, nil)
			w.WriteHeader(resp.StatusCode)
			w.Write(bodyBytes)
			return
		}

		isStream := utils.ShouldStreamResponse(r, resp)
		log.Printf("[V1CHAT] DECIDE_STREAM stream_req=%v stream_resp=%v content_type=%s",
			streamReq, isStream, resp.Header.Get("Content-Type"))

		if isStream && !streamReq {
			log.Printf("[V1CHAT] STREAM_TO_NONSTREAM_START")
			payload, usage := readChatStreamAsOpenAINonStreaming(resp, upstreamReq.Kind, model)
			resp.Body.Close()
			bodyBytes, _ := json.Marshal(payload)

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(resp.StatusCode)
			w.Write(bodyBytes)

			logging.RecordRequestLog(logging.RequestLogParams{
				UserID:         info.User.ID,
				UserName:       info.User.Name,
				Username:       info.User.Username,
				APIKeyID:       getKeyID(info.APIKeyRecord),
				APIKeyName:     getKeyName(info.APIKeyRecord),
				APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
				ProviderID:     candidate.Provider.ID,
				ProviderName:   candidate.Provider.Name,
				Model:          model,
				UpstreamModel:  candidate.UpstreamModel,
				Endpoint:       r.URL.Path,
				Method:         r.Method,
				Status:         resp.StatusCode,
				OK:             true,
				Stream:         false,
				DurationMs:     int(time.Since(startedAt).Milliseconds()),
				Usage:          usage,
				RequestContent: requestContent,
			})
			proxy.RecordProviderSuccess(candidate.Provider.ID)
			log.Printf("[V1CHAT] === DONE (stream aggregated) === duration=%dms", int(time.Since(startedAt).Milliseconds()))
			return
		}

		if isStream {
			log.Printf("[V1CHAT] STREAM_START")
			utils.CopyUpstreamHeaders(resp.Header, w, map[string]string{
				"Cache-Control":     "no-cache, no-transform",
				"X-Accel-Buffering": "no",
			})
			w.WriteHeader(resp.StatusCode)
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}

			var usage interface{}
			if upstreamReq.NeedsChatResponseConversion && upstreamReq.Kind == proxy.UpstreamGemini {
				usage = writeGeminiStreamAsOpenAI(resp, w, model)
			} else if upstreamReq.NeedsChatResponseConversion && upstreamReq.Kind == proxy.UpstreamAnthropic {
				usage = writeAnthropicStreamAsOpenAI(resp, w, model)
			} else {
				usage = proxy.WriteUpstreamStreamToResponse(resp, w)
			}
			log.Printf("[V1CHAT] STREAM_END usage=%v", usage)

			logging.RecordRequestLog(logging.RequestLogParams{
				UserID:         info.User.ID,
				UserName:       info.User.Name,
				Username:       info.User.Username,
				APIKeyID:       getKeyID(info.APIKeyRecord),
				APIKeyName:     getKeyName(info.APIKeyRecord),
				APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
				ProviderID:     candidate.Provider.ID,
				ProviderName:   candidate.Provider.Name,
				Model:          model,
				UpstreamModel:  candidate.UpstreamModel,
				Endpoint:       r.URL.Path,
				Method:         r.Method,
				Status:         resp.StatusCode,
				OK:             true,
				Stream:         true,
				DurationMs:     int(time.Since(startedAt).Milliseconds()),
				Usage:          usage,
				RequestContent: requestContent,
			})
			proxy.RecordProviderSuccess(candidate.Provider.ID)
			resp.Body.Close()
			log.Printf("[V1CHAT] === DONE (stream) === duration=%dms", int(time.Since(startedAt).Milliseconds()))
			return
		}

		log.Printf("[V1CHAT] NONSTREAM_START")
		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		log.Printf("[V1CHAT] NONSTREAM_BODY len=%d preview=%s", len(bodyBytes), truncateForLog(string(bodyBytes), 300))
		usage := utils.ExtractUsageFromResponseText(string(bodyBytes))
		if upstreamReq.NeedsChatResponseConversion {
			var payload map[string]interface{}
			if json.Unmarshal(bodyBytes, &payload) == nil {
				switch upstreamReq.Kind {
				case proxy.UpstreamAnthropic:
					converted := proxy.AnthropicToOpenAIChat(payload, model)
					bodyBytes, _ = json.Marshal(converted)
					usage = utils.FindUsagePayload(converted)
				case proxy.UpstreamGemini:
					converted := proxy.GeminiToOpenAIChat(payload, model)
					bodyBytes, _ = json.Marshal(converted)
					usage = utils.FindUsagePayload(converted)
				}
			}
		}

		utils.CopyUpstreamHeaders(resp.Header, w, nil)
		w.WriteHeader(resp.StatusCode)
		w.Write(bodyBytes)

		logging.RecordRequestLog(logging.RequestLogParams{
			UserID:         info.User.ID,
			UserName:       info.User.Name,
			Username:       info.User.Username,
			APIKeyID:       getKeyID(info.APIKeyRecord),
			APIKeyName:     getKeyName(info.APIKeyRecord),
			APIKeyPreview:  maskKeyPreview(info.APIKeyRecord.Key),
			ProviderID:     candidate.Provider.ID,
			ProviderName:   candidate.Provider.Name,
			Model:          model,
			UpstreamModel:  candidate.UpstreamModel,
			Endpoint:       r.URL.Path,
			Method:         r.Method,
			Status:         resp.StatusCode,
			OK:             true,
			Stream:         false,
			DurationMs:     int(time.Since(startedAt).Milliseconds()),
			Usage:          usage,
			RequestContent: requestContent,
		})
		proxy.RecordProviderSuccess(candidate.Provider.ID)
		log.Printf("[V1CHAT] === DONE (nonstream) === duration=%dms", int(time.Since(startedAt).Milliseconds()))
		return
	}

	msg := "All upstream providers failed."
	if lastError != nil {
		msg = "All upstream providers failed. Last error: " + lastError.Error()
	}
	log.Printf("[V1CHAT] ALL_FAILED last_error=%v", lastError)
	utils.SendError(w, 502, msg, "upstream_request_failed")
}

func getKeyID(k *models.APIKeyRecord) string {
	if k == nil {
		return ""
	}
	return k.ID
}

func getKeyName(k *models.APIKeyRecord) string {
	if k == nil {
		return ""
	}
	return k.Name
}

func getToolCalls(delta map[string]interface{}) []interface{} {
	if tc, ok := delta["tool_calls"].([]interface{}); ok {
		return tc
	}
	return nil
}

func toStringSafe(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func readLine(reader *bufio.Reader, buf *strings.Builder) (string, error) {
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

func readChatStreamAsOpenAINonStreaming(upstreamResp *http.Response, kind proxy.UpstreamKind, model string) (map[string]interface{}, interface{}) {
	reader := bufio.NewReader(upstreamResp.Body)
	var buf strings.Builder
	var outputText strings.Builder
	var usagePayload interface{}
	finishReason := ""
	chatID := ""
	created := int64(0)
	responseModel := model
	role := "assistant"

	for {
		line, err := readLine(reader, &buf)
		if err != nil {
			break
		}
		line = upstreamStreamLineAsOpenAI(line, kind, model)
		for _, item := range sseDataItems(line) {
			if item == "[DONE]" {
				continue
			}
			var payload map[string]interface{}
			if json.Unmarshal([]byte(item), &payload) != nil {
				continue
			}

			if id, _ := payload["id"].(string); chatID == "" && id != "" {
				chatID = id
			}
			if created == 0 {
				switch v := payload["created"].(type) {
				case float64:
					created = int64(v)
				case int64:
					created = v
				case int:
					created = int64(v)
				}
			}
			if m, _ := payload["model"].(string); m != "" {
				responseModel = m
			}

			if choices, _ := payload["choices"].([]interface{}); len(choices) > 0 {
				if choice, _ := choices[0].(map[string]interface{}); choice != nil {
					if delta, _ := choice["delta"].(map[string]interface{}); delta != nil {
						if r, _ := delta["role"].(string); r != "" {
							role = r
						}
					}
				}
			}

			dText, dFinish, dUsage := proxy.ExtractChatCompletionText(payload)
			if dText != "" {
				outputText.WriteString(dText)
			}
			if dFinish != "" {
				finishReason = dFinish
			}
			if dUsage != nil {
				usagePayload = dUsage
			}
		}
	}

	if chatID == "" {
		chatID = utils.GenerateID("chatcmpl")
	}
	if created == 0 {
		created = utils.GenerateTimestamp()
	}
	if responseModel == "" {
		responseModel = model
	}
	if finishReason == "" {
		finishReason = "stop"
	}

	result := map[string]interface{}{
		"id":      chatID,
		"object":  "chat.completion",
		"created": created,
		"model":   responseModel,
		"choices": []interface{}{
			map[string]interface{}{
				"index": 0,
				"message": map[string]interface{}{
					"role":    role,
					"content": outputText.String(),
				},
				"finish_reason": finishReason,
			},
		},
	}
	if usagePayload != nil {
		result["usage"] = usagePayload
	}
	return result, usagePayload
}

func sseDataItems(line string) []string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, ":") {
		return nil
	}
	if !strings.Contains(trimmed, "data:") {
		if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
			return []string{trimmed}
		}
		return nil
	}

	segments := strings.Split(trimmed, "data:")
	items := make([]string, 0, len(segments)-1)
	for _, segment := range segments[1:] {
		item := strings.TrimSpace(segment)
		if item == "" {
			continue
		}
		items = append(items, item)
	}
	return items
}

func buildAnthropicMessagesUpstreamRequest(provider models.Provider, anthropicBody map[string]interface{}, openAIBody map[string]interface{}, upstreamModel string) (proxy.ChatCompletionsUpstreamRequest, error) {
	if proxy.ProviderUpstreamKind(provider) == proxy.UpstreamAnthropic {
		return proxy.BuildAnthropicMessagesUpstreamRequestDetailed(provider, anthropicBody, upstreamModel)
	}
	return proxy.BuildChatCompletionsUpstreamRequestDetailed(provider, "/v1/chat/completions", "", openAIBody, upstreamModel)
}

func upstreamChatPayloadAsOpenAI(payload map[string]interface{}, kind proxy.UpstreamKind, model string) map[string]interface{} {
	if payload == nil {
		return map[string]interface{}{}
	}
	switch kind {
	case proxy.UpstreamAnthropic:
		return proxy.AnthropicToOpenAIChat(payload, model)
	case proxy.UpstreamGemini:
		return proxy.GeminiToOpenAIChat(payload, model)
	default:
		return payload
	}
}

func upstreamStreamLineAsOpenAI(line string, kind proxy.UpstreamKind, model string) string {
	switch kind {
	case proxy.UpstreamAnthropic:
		return proxy.AnthropicStreamLineToOpenAI(line, model)
	case proxy.UpstreamGemini:
		return proxy.GeminiStreamChunkToOpenAI(line, model)
	default:
		return line
	}
}

func writeGeminiStreamAsOpenAI(upstreamResp *http.Response, w http.ResponseWriter, model string) interface{} {
	reader := bufio.NewReader(upstreamResp.Body)
	var buf strings.Builder
	var usage interface{}

	for {
		line, err := readLine(reader, &buf)
		if err != nil {
			break
		}
		chunk := proxy.GeminiStreamChunkToOpenAI(line, model)
		if chunk == "" {
			continue
		}
		w.Write([]byte(chunk))
		usage = utils.ExtractUsageFromResponseText(chunk)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}
	w.Write([]byte("data: [DONE]\n\n"))
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	return usage
}

func writeAnthropicStreamAsOpenAI(upstreamResp *http.Response, w http.ResponseWriter, model string) interface{} {
	reader := bufio.NewReader(upstreamResp.Body)
	var buf strings.Builder
	var usage interface{}

	for {
		line, err := readLine(reader, &buf)
		if err != nil {
			break
		}
		chunk := proxy.AnthropicStreamLineToOpenAI(line, model)
		if chunk == "" {
			continue
		}
		w.Write([]byte(chunk))
		usage = utils.ExtractUsageFromResponseText(chunk)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}
	w.Write([]byte("data: [DONE]\n\n"))
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	return usage
}

func isOK(statusCode int) bool {
	return statusCode >= 200 && statusCode < 300
}

func truncateForLog(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "...[truncated]"
}

func extractMessages(body map[string]interface{}) []interface{} {
	if body == nil {
		return nil
	}
	if msgs, ok := body["messages"].([]interface{}); ok {
		return msgs
	}
	return nil
}

func isChatCompletionsRequestPath(path string) bool {
	cleaned := strings.Trim(path, "/")
	return cleaned == "chat/completions" || cleaned == "v1/chat/completions"
}

func filterGPTChatCompletionsCandidates(candidates []proxy.ProviderCandidate) ([]proxy.ProviderCandidate, bool) {
	filtered := make([]proxy.ProviderCandidate, 0, len(candidates))
	blocked := false
	for _, candidate := range candidates {
		if proxy.IsGPTModelID(candidate.UpstreamModel) {
			blocked = true
			continue
		}
		filtered = append(filtered, candidate)
	}
	return filtered, blocked
}

func sendGPTChatCompletionsDisabledError(w http.ResponseWriter, model string) {
	message := "GPT models are disabled for Chat Completions."
	if strings.TrimSpace(model) != "" {
		message = fmt.Sprintf("GPT model %q is disabled for Chat Completions.", model)
	}
	utils.SendError(w, http.StatusForbidden, message, "gpt_chat_completions_disabled")
}
