package proxy

import (
	"encoding/json"
	"testing"
)

func TestConvertResponsesToolsToChatTools(t *testing.T) {
	tools := []interface{}{
		map[string]interface{}{
			"type":        "function",
			"name":        "shell",
			"description": "Run a shell command.",
			"parameters": map[string]interface{}{
				"type": "object",
			},
		},
		map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        "read_file",
				"description": "Read a file.",
				"parameters": map[string]interface{}{
					"type": "object",
				},
			},
		},
		map[string]interface{}{
			"type": "function",
			"name": "",
		},
		map[string]interface{}{
			"type":        "custom",
			"name":        "apply_patch",
			"description": "Apply a patch.",
			"format": map[string]interface{}{
				"type": "text",
			},
		},
		map[string]interface{}{
			"type": "custom",
			"name": "",
		},
		map[string]interface{}{
			"type": "web_search_preview",
		},
	}

	chatTools := ConvertResponsesToolsToChatTools(tools)
	if len(chatTools) != 3 {
		t.Fatalf("expected 3 converted tools, got %d", len(chatTools))
	}

	firstFunction := chatTools[0]["function"].(map[string]interface{})
	if firstFunction["name"] != "shell" {
		t.Fatalf("expected first tool name shell, got %v", firstFunction["name"])
	}
	if firstFunction["description"] != "Run a shell command." {
		t.Fatalf("expected description to be preserved, got %v", firstFunction["description"])
	}

	secondFunction := chatTools[1]["function"].(map[string]interface{})
	if secondFunction["name"] != "read_file" {
		t.Fatalf("expected second tool name read_file, got %v", secondFunction["name"])
	}

	customFunction := chatTools[2]["function"].(map[string]interface{})
	if customFunction["name"] != "apply_patch" {
		t.Fatalf("expected custom tool to map to function name apply_patch, got %v", customFunction["name"])
	}
	if customFunction["description"] != "Apply a patch." {
		t.Fatalf("expected custom description to be preserved, got %v", customFunction["description"])
	}
	params := customFunction["parameters"].(map[string]interface{})
	if params["type"] != "object" {
		t.Fatalf("expected custom tool parameters object schema, got %#v", params)
	}
}

func TestConvertToChatCompletionsPayloadFiltersInvalidTools(t *testing.T) {
	payload := ConvertToChatCompletionsPayload(map[string]interface{}{
		"model": "test-model",
		"input": "hello",
		"tools": []interface{}{
			map[string]interface{}{
				"type": "function",
				"name": "",
			},
		},
	})

	if _, ok := payload["tools"]; ok {
		t.Fatalf("expected invalid tools to be omitted, got %v", payload["tools"])
	}
	if _, ok := payload["tool_choice"]; ok {
		t.Fatalf("expected tool_choice to be omitted when tools are invalid, got %v", payload["tool_choice"])
	}
}

func TestConvertResponsesToolChoiceToChat(t *testing.T) {
	tools := ConvertResponsesToolsToChatTools([]interface{}{
		map[string]interface{}{
			"type": "function",
			"name": "shell",
		},
	})

	choice, ok := ConvertResponsesToolChoiceToChat(map[string]interface{}{
		"type": "function",
		"name": "shell",
	}, tools)
	if !ok {
		t.Fatal("expected tool choice to convert")
	}

	choiceMap := choice.(map[string]interface{})
	function := choiceMap["function"].(map[string]interface{})
	if function["name"] != "shell" {
		t.Fatalf("expected tool choice name shell, got %v", function["name"])
	}
}

func TestConvertResponsesCustomToolChoiceToChat(t *testing.T) {
	tools := ConvertResponsesToolsToChatTools([]interface{}{
		map[string]interface{}{
			"type": "custom",
			"name": "apply_patch",
		},
	})

	choice, ok := ConvertResponsesToolChoiceToChat(map[string]interface{}{
		"type": "custom",
		"name": "apply_patch",
	}, tools)
	if !ok {
		t.Fatal("expected custom tool choice to convert")
	}

	choiceMap := choice.(map[string]interface{})
	function := choiceMap["function"].(map[string]interface{})
	if function["name"] != "apply_patch" {
		t.Fatalf("expected custom tool choice to map to function name apply_patch, got %v", function["name"])
	}
}

func TestConvertInputToMessagesPreservesToolHistory(t *testing.T) {
	messages := convertInputToMessages([]interface{}{
		map[string]interface{}{
			"type":      "function_call",
			"call_id":   "call_123",
			"name":      "shell",
			"arguments": `{"command":"ls"}`,
		},
		map[string]interface{}{
			"type":    "function_call_output",
			"call_id": "call_123",
			"output":  "ok",
		},
		map[string]interface{}{
			"role":    "user",
			"content": "next",
		},
	}, "")

	if len(messages) != 3 {
		t.Fatalf("expected 3 messages, got %d: %#v", len(messages), messages)
	}

	assistant := messages[0]
	if assistant["role"] != "assistant" {
		t.Fatalf("expected assistant tool-call message, got %v", assistant["role"])
	}
	toolCalls := assistant["tool_calls"].([]interface{})
	call := toolCalls[0].(map[string]interface{})
	if call["id"] != "call_123" {
		t.Fatalf("expected call id call_123, got %v", call["id"])
	}

	toolMessage := messages[1]
	if toolMessage["role"] != "tool" || toolMessage["tool_call_id"] != "call_123" {
		t.Fatalf("expected tool output message, got %#v", toolMessage)
	}

	user := messages[2]
	if user["role"] != "user" || user["content"] != "next" {
		t.Fatalf("expected trailing user message, got %#v", user)
	}
}

func TestConvertInputToMessagesPreservesCustomToolHistory(t *testing.T) {
	messages := convertInputToMessages([]interface{}{
		map[string]interface{}{
			"type":    "custom_tool_call",
			"call_id": "call_456",
			"name":    "apply_patch",
			"input":   "*** Begin Patch",
		},
		map[string]interface{}{
			"type":    "custom_tool_call_output",
			"call_id": "call_456",
			"output":  "Done!",
		},
	}, "")

	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d: %#v", len(messages), messages)
	}

	toolCalls := messages[0]["tool_calls"].([]interface{})
	call := toolCalls[0].(map[string]interface{})
	if call["type"] != "function" {
		t.Fatalf("expected custom history to map to function chat tool call, got %#v", call)
	}
	function := call["function"].(map[string]interface{})
	if function["name"] != "apply_patch" {
		t.Fatalf("unexpected custom chat tool call name: %#v", function)
	}
	var args map[string]string
	if err := json.Unmarshal([]byte(function["arguments"].(string)), &args); err != nil {
		t.Fatalf("custom function arguments are not JSON: %v", err)
	}
	if args["input"] != "*** Begin Patch" {
		t.Fatalf("expected custom input to be wrapped as function arguments, got %#v", args)
	}

	toolMessage := messages[1]
	if toolMessage["role"] != "tool" || toolMessage["tool_call_id"] != "call_456" {
		t.Fatalf("expected custom tool output message, got %#v", toolMessage)
	}
}

func TestConvertInputToMessagesPreservesResponsesImageBlocks(t *testing.T) {
	messages := convertInputToMessages([]interface{}{
		map[string]interface{}{
			"role": "user",
			"content": []interface{}{
				map[string]interface{}{
					"type": "input_text",
					"text": "describe this image",
				},
				map[string]interface{}{
					"type":      "input_image",
					"image_url": "data:image/png;base64,abc123",
				},
			},
		},
	}, "")

	if len(messages) != 1 {
		t.Fatalf("expected 1 message, got %d: %#v", len(messages), messages)
	}
	if messages[0]["role"] != "user" {
		t.Fatalf("expected user role, got %v", messages[0]["role"])
	}

	content := messages[0]["content"].([]interface{})
	if len(content) != 2 {
		t.Fatalf("expected 2 multimodal content parts, got %d: %#v", len(content), content)
	}

	textPart := content[0].(map[string]interface{})
	if textPart["type"] != "text" || textPart["text"] != "describe this image" {
		t.Fatalf("expected text part to be preserved, got %#v", textPart)
	}

	imagePart := content[1].(map[string]interface{})
	if imagePart["type"] != "image_url" {
		t.Fatalf("expected image_url part, got %#v", imagePart)
	}
	imageURL := imagePart["image_url"].(map[string]interface{})
	if imageURL["url"] != "data:image/png;base64,abc123" {
		t.Fatalf("expected image data URL to be preserved, got %#v", imageURL)
	}
}

func TestConvertInputToMessagesUsesTextForTextOnlyResponsesParts(t *testing.T) {
	messages := convertInputToMessages([]interface{}{
		map[string]interface{}{
			"role": "user",
			"content": []interface{}{
				map[string]interface{}{"type": "input_text", "text": "first"},
				map[string]interface{}{"type": "input_file", "filename": "notes.md", "text": "second"},
			},
		},
	}, "")

	if len(messages) != 1 {
		t.Fatalf("expected 1 message, got %d: %#v", len(messages), messages)
	}
	content, ok := messages[0]["content"].(string)
	if !ok {
		t.Fatalf("expected text-only content to stay string, got %#v", messages[0]["content"])
	}
	if content != "first\n[Uploaded file: notes.md]\nsecond" {
		t.Fatalf("unexpected text-only content: %q", content)
	}
}

func TestConvertInputToMessagesPreservesResponsesAudioBlocks(t *testing.T) {
	messages := convertInputToMessages([]interface{}{
		map[string]interface{}{
			"role": "user",
			"content": []interface{}{
				map[string]interface{}{"type": "input_text", "text": "transcribe"},
				map[string]interface{}{
					"type": "input_audio",
					"input_audio": map[string]interface{}{
						"data":   "abc123",
						"format": "mp3",
					},
				},
			},
		},
	}, "")

	content := messages[0]["content"].([]interface{})
	audioPart := content[1].(map[string]interface{})
	if audioPart["type"] != "input_audio" {
		t.Fatalf("expected input_audio part, got %#v", audioPart)
	}
	inputAudio := audioPart["input_audio"].(map[string]interface{})
	if inputAudio["data"] != "abc123" || inputAudio["format"] != "mp3" {
		t.Fatalf("unexpected audio payload: %#v", inputAudio)
	}
}

func TestConvertResponsesTextFormatToChatResponseFormat(t *testing.T) {
	payload := ConvertToChatCompletionsPayload(map[string]interface{}{
		"model": "test-model",
		"input": "hello",
		"text": map[string]interface{}{
			"format": map[string]interface{}{
				"type":   "json_schema",
				"name":   "result",
				"strict": true,
				"schema": map[string]interface{}{
					"type": "object",
				},
			},
		},
	})

	format := payload["response_format"].(map[string]interface{})
	if format["type"] != "json_schema" {
		t.Fatalf("expected json_schema response_format, got %#v", format)
	}
	jsonSchema := format["json_schema"].(map[string]interface{})
	if jsonSchema["name"] != "result" || jsonSchema["strict"] != true {
		t.Fatalf("unexpected json schema payload: %#v", jsonSchema)
	}
}

func TestExtractChatCompletionToolCallItemsRestoresCustomToolsFromFunctions(t *testing.T) {
	items := ExtractChatCompletionToolCallItems(map[string]interface{}{
		"choices": []interface{}{
			map[string]interface{}{
				"message": map[string]interface{}{
					"tool_calls": []interface{}{
						map[string]interface{}{
							"id":   "call_456",
							"type": "function",
							"function": map[string]interface{}{
								"name":      "apply_patch",
								"arguments": `{"input":"*** Begin Patch"}`,
							},
						},
					},
				},
			},
		},
	}, map[string]bool{"apply_patch": true})

	if len(items) != 1 {
		t.Fatalf("expected 1 custom tool call item, got %d", len(items))
	}
	item := items[0].(map[string]interface{})
	if item["type"] != "custom_tool_call" || item["call_id"] != "call_456" || item["name"] != "apply_patch" {
		t.Fatalf("unexpected restored custom tool call: %#v", item)
	}
	if item["input"] != "*** Begin Patch" {
		t.Fatalf("expected restored custom input, got %v", item["input"])
	}
}

func TestChatToolCallAccumulatorCombinesStreamingFunctionArguments(t *testing.T) {
	accumulator := NewChatToolCallAccumulator()
	accumulator.AddChunk(map[string]interface{}{
		"choices": []interface{}{
			map[string]interface{}{
				"delta": map[string]interface{}{
					"tool_calls": []interface{}{
						map[string]interface{}{
							"index": float64(0),
							"id":    "call_789",
							"type":  "function",
							"function": map[string]interface{}{
								"name":      "apply_patch",
								"arguments": `{"input":"*** Begin`,
							},
						},
					},
				},
			},
		},
	})
	accumulator.AddChunk(map[string]interface{}{
		"choices": []interface{}{
			map[string]interface{}{
				"delta": map[string]interface{}{
					"tool_calls": []interface{}{
						map[string]interface{}{
							"index": float64(0),
							"function": map[string]interface{}{
								"arguments": ` Patch"}`,
							},
						},
					},
				},
			},
		},
	})

	items := accumulator.Items(map[string]bool{"apply_patch": true})
	if len(items) != 1 {
		t.Fatalf("expected 1 accumulated custom tool call, got %d", len(items))
	}
	item := items[0].(map[string]interface{})
	if item["type"] != "custom_tool_call" || item["input"] != "*** Begin Patch" {
		t.Fatalf("unexpected accumulated custom tool call: %#v", item)
	}
}

func TestExtractChatCompletionFunctionCallItems(t *testing.T) {
	items := ExtractChatCompletionFunctionCallItems(map[string]interface{}{
		"choices": []interface{}{
			map[string]interface{}{
				"message": map[string]interface{}{
					"tool_calls": []interface{}{
						map[string]interface{}{
							"id":   "call_123",
							"type": "function",
							"function": map[string]interface{}{
								"name":      "shell",
								"arguments": `{"command":"ls"}`,
							},
						},
					},
				},
			},
		},
	})

	if len(items) != 1 {
		t.Fatalf("expected 1 function call item, got %d", len(items))
	}
	item := items[0].(map[string]interface{})
	if item["type"] != "function_call" || item["call_id"] != "call_123" || item["name"] != "shell" {
		t.Fatalf("unexpected function call item: %#v", item)
	}
	if item["arguments"] != `{"command":"ls"}` {
		t.Fatalf("expected arguments to be preserved, got %v", item["arguments"])
	}
}

func TestExtractChatCompletionCustomToolCallItems(t *testing.T) {
	items := ExtractChatCompletionFunctionCallItems(map[string]interface{}{
		"choices": []interface{}{
			map[string]interface{}{
				"message": map[string]interface{}{
					"tool_calls": []interface{}{
						map[string]interface{}{
							"id":   "call_456",
							"type": "custom",
							"custom": map[string]interface{}{
								"name":  "apply_patch",
								"input": "*** Begin Patch",
							},
						},
					},
				},
			},
		},
	})

	if len(items) != 1 {
		t.Fatalf("expected 1 custom tool call item, got %d", len(items))
	}
	item := items[0].(map[string]interface{})
	if item["type"] != "custom_tool_call" || item["call_id"] != "call_456" || item["name"] != "apply_patch" {
		t.Fatalf("unexpected custom tool call item: %#v", item)
	}
	if item["input"] != "*** Begin Patch" {
		t.Fatalf("expected custom input to be preserved, got %v", item["input"])
	}
}

func TestBuildIncompleteDetailsTreatsToolCallsAsComplete(t *testing.T) {
	if details := BuildIncompleteDetails("tool_calls"); details != nil {
		t.Fatalf("expected tool_calls finish reason not to mark response incomplete, got %#v", details)
	}
}
