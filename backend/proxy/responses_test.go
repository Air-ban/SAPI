package proxy

import "testing"

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

	custom := chatTools[2]["custom"].(map[string]interface{})
	if custom["name"] != "apply_patch" {
		t.Fatalf("expected custom tool name apply_patch, got %v", custom["name"])
	}
	if custom["description"] != "Apply a patch." {
		t.Fatalf("expected custom description to be preserved, got %v", custom["description"])
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
	custom := choiceMap["custom"].(map[string]interface{})
	if custom["name"] != "apply_patch" {
		t.Fatalf("expected custom tool choice name apply_patch, got %v", custom["name"])
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
	if call["type"] != "custom" {
		t.Fatalf("expected custom chat tool call, got %#v", call)
	}
	custom := call["custom"].(map[string]interface{})
	if custom["name"] != "apply_patch" || custom["input"] != "*** Begin Patch" {
		t.Fatalf("unexpected custom chat tool call: %#v", custom)
	}

	toolMessage := messages[1]
	if toolMessage["role"] != "tool" || toolMessage["tool_call_id"] != "call_456" {
		t.Fatalf("expected custom tool output message, got %#v", toolMessage)
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
