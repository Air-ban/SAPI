package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"sapi/utils"
)

func readJSONBody(w http.ResponseWriter, r *http.Request) (map[string]interface{}, bool) {
	var body map[string]interface{}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		status := http.StatusBadRequest
		code := "invalid_json"
		message := "Request body must be valid JSON."
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			status = http.StatusRequestEntityTooLarge
			code = "request_too_large"
			message = "Request body is too large."
		}
		utils.SendError(w, status, message, code)
		return nil, false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		utils.SendError(w, http.StatusBadRequest, "Request body must contain a single JSON object.", "invalid_json")
		return nil, false
	}
	if body == nil {
		body = map[string]interface{}{}
	}
	return body, true
}

func readFlexibleJSONBody(w http.ResponseWriter, r *http.Request) (map[string]interface{}, bool) {
	var body map[string]interface{}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&body); err != nil {
		status := http.StatusBadRequest
		code := "invalid_json"
		message := "Request body must be valid JSON."
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			status = http.StatusRequestEntityTooLarge
			code = "request_too_large"
			message = "Request body is too large."
		}
		utils.SendError(w, status, message, code)
		return nil, false
	}
	if body == nil {
		body = map[string]interface{}{}
	}
	return body, true
}
