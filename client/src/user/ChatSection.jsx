import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from "@mui/material";
import ArticleIcon from "@mui/icons-material/Article";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import AudiotrackIcon from "@mui/icons-material/Audiotrack";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ClearIcon from "@mui/icons-material/Clear";
import CodeIcon from "@mui/icons-material/Code";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import HtmlIcon from "@mui/icons-material/Html";
import ImageIcon from "@mui/icons-material/Image";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import SendIcon from "@mui/icons-material/Send";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import TextSnippetIcon from "@mui/icons-material/TextSnippet";
import VideocamIcon from "@mui/icons-material/Videocam";
import { marked } from "marked";
import { EmptyState } from "../components/EmptyState";
import { normalizeModelFrontend } from "../utils/helpers";

const MAX_ATTACHMENTS = 6;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const HISTORY_LIMIT = 10;
const CHAT_MODES = [
  { id: "text", label: "文本" },
  { id: "code", label: "代码" },
  { id: "vision", label: "视觉" },
  { id: "audio", label: "音频" },
  { id: "markdown", label: "Markdown" },
  { id: "html", label: "HTML" },
  { id: "json_schema", label: "结构化" },
  { id: "function", label: "函数调用" },
  { id: "tools", label: "使用工具" }
];
const DEFAULT_JSON_SCHEMA = JSON.stringify(
  {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      items: { type: "array", items: { type: "string" } }
    },
    required: ["title", "summary", "items"]
  },
  null,
  2
);

const DEFAULT_FUNCTION_TOOL = JSON.stringify(
  {
    type: "function",
    name: "create_downloadable_asset",
    description: "Return a downloadable artifact generated from the user request.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        filename: { type: "string" },
        mimeType: { type: "string" },
        content: { type: "string" }
      },
      required: ["filename", "mimeType", "content"]
    }
  },
  null,
  2
);

function makeID(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getFileKind(file) {
  const type = file.type || "";
  const name = file.name.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type === "text/html" || name.endsWith(".html") || name.endsWith(".htm")) return "html";
  if (type === "text/markdown" || name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (
    type.startsWith("text/") ||
    /\.(txt|json|csv|xml|yaml|yml|log|js|jsx|ts|tsx|css|scss|go|py|java|rs|sh|sql)$/i.test(name)
  ) {
    return "text";
  }
  return "file";
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function dataURLPayload(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;,]+)?(?:;[^,]*)?,(.*)$/);
  if (!match) return { data: dataUrl, mime: "" };
  return { data: match[2] || "", mime: match[1] || "" };
}

function dataURLMime(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;,]+)?/);
  return match?.[1] || "";
}

function audioFormatFromMime(mime = "", filename = "") {
  const text = `${mime} ${filename}`.toLowerCase();
  if (text.includes("wav")) return "wav";
  if (text.includes("ogg")) return "ogg";
  if (text.includes("webm")) return "webm";
  if (text.includes("m4a")) return "m4a";
  if (text.includes("mp3") || text.includes("mpeg")) return "mp3";
  return "mp3";
}

function sanitizeFilename(name) {
  return String(name || "sapi-chat")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "sapi-chat";
}

function downloadBlob(content, filename, mime = "text/plain;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content || ""], { type: mime });
  const url = URL.createObjectURL(blob);
  downloadURL(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadURL(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = sanitizeFilename(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function looksLikeHTML(text = "") {
  return /<!doctype\s+html|<html[\s>]|<body[\s>]|<\/(div|section|article|main|table|style|script|p|h[1-6])>|<(div|section|article|main|table|style|p|h[1-6])[\s>]/i.test(text);
}

function looksLikeMarkdown(text = "") {
  return /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.+\|)/.test(text);
}

function htmlDocumentFromBody(body = "", mode = "html") {
  const content = mode === "markdown" ? marked.parse(body || "") : body || "";
  const isFullDocument = /<!doctype\s+html|<html[\s>]/i.test(content);
  const styles = `
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        padding: 18px;
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.65;
        color: #111827;
        background: #ffffff;
      }
      pre {
        overflow: auto;
        padding: 14px;
        border-radius: 8px;
        background: #111827;
        color: #d1fae5;
      }
      code { font-family: Consolas, "SFMono-Regular", Menlo, monospace; }
      img, video { max-width: 100%; height: auto; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #d7dde8; padding: 8px; text-align: left; }
      blockquote { margin: 14px 0; padding: 8px 14px; border-left: 4px solid #0f5cc0; background: #e7f0ff; }
      @media (prefers-color-scheme: dark) {
        body { color: #f8fafc; background: #111827; }
        th, td { border-color: #334155; }
        blockquote { background: rgba(124,183,255,0.16); }
      }
    </style>`;
  if (isFullDocument) {
    return content.replace(/<\/head>/i, `${styles}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${styles}</head><body>${content}</body></html>`;
}

function defaultRenderMode(content = "") {
  if (looksLikeHTML(content)) return "html";
  if (looksLikeMarkdown(content)) return "markdown";
  return "text";
}

function fileIcon(kind) {
  switch (kind) {
    case "image":
      return <ImageIcon fontSize="small" />;
    case "audio":
      return <AudiotrackIcon fontSize="small" />;
    case "video":
      return <VideocamIcon fontSize="small" />;
    case "html":
      return <HtmlIcon fontSize="small" />;
    case "markdown":
      return <ArticleIcon fontSize="small" />;
    case "text":
      return <TextSnippetIcon fontSize="small" />;
    default:
      return <InsertDriveFileIcon fontSize="small" />;
  }
}

function attachmentText(attachment) {
  if (!attachment) return "";
  if (attachment.text) {
    return `[Uploaded file: ${attachment.name}]\n${attachment.text}`;
  }
  return `[Uploaded media: ${attachment.name}; type=${attachment.type || attachment.kind}; size=${formatBytes(attachment.size)}]`;
}

function buildContentBlocks(prompt, attachments) {
  const blocks = [];
  const text = prompt.trim();
  if (text) {
    blocks.push({ type: "input_text", text });
  }
  for (const attachment of attachments) {
    if (attachment.kind === "image" && attachment.dataUrl) {
      blocks.push({ type: "input_image", image_url: attachment.dataUrl });
      continue;
    }
    if (attachment.kind === "audio" && attachment.dataUrl) {
      const payload = dataURLPayload(attachment.dataUrl);
      blocks.push({
        type: "input_audio",
        input_audio: {
          data: payload.data,
          format: audioFormatFromMime(payload.mime || attachment.type, attachment.name)
        }
      });
      continue;
    }
    if ((attachment.kind === "file" || attachment.kind === "video") && attachment.dataUrl) {
      blocks.push({
        type: "input_file",
        filename: attachment.name,
        file_data: attachment.dataUrl
      });
      continue;
    }
    blocks.push({
      type: "input_file",
      filename: attachment.name,
      text: attachmentText(attachment)
    });
  }
  return blocks;
}

function buildModeInstructions(mode) {
  switch (mode) {
    case "code":
      return "Return concise, production-ready code. Include short notes only when needed.";
    case "markdown":
      return "Return the final answer as GitHub-flavored Markdown.";
    case "html":
      return "Return a complete, self-contained HTML document when useful. Keep scripts minimal.";
    case "json_schema":
      return "Return only data that conforms to the requested JSON schema.";
    case "function":
      return "Use the provided function tool when the requested result should become a downloadable asset.";
    case "tools":
      return "Use available built-in tools when they materially improve the answer.";
    case "vision":
      return "Analyze the supplied image inputs carefully and answer with visual details.";
    case "audio":
      return "Use the supplied audio context when the model supports audio input.";
    default:
      return "";
  }
}

function buildResponseRequest({ model, input, mode, schemaDraft, functionDraft }) {
  const body = {
    model,
    input,
    stream: false,
    store: false
  };
  const instructions = buildModeInstructions(mode);
  if (instructions) {
    body.instructions = instructions;
  }
  if (mode === "json_schema") {
    let schema = null;
    try {
      schema = JSON.parse(schemaDraft);
    } catch {
      schema = JSON.parse(DEFAULT_JSON_SCHEMA);
    }
    body.text = {
      format: {
        type: "json_schema",
        name: "sapi_chat_result",
        strict: true,
        schema
      }
    };
  }
  if (mode === "function") {
    try {
      body.tools = [JSON.parse(functionDraft)];
    } catch {
      body.tools = [JSON.parse(DEFAULT_FUNCTION_TOOL)];
    }
    body.tool_choice = "auto";
  }
  if (mode === "tools") {
    body.tools = [
      { type: "web_search_preview" },
      { type: "code_interpreter", container: { type: "auto" } },
      { type: "image_generation" }
    ];
    body.tool_choice = "auto";
    body.include = ["web_search_call.action.sources"];
  }
  return body;
}

function messageToResponsesItem(message) {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: [{ type: "output_text", text: message.content || "" }]
    };
  }
  return {
    role: "user",
    content: message.contentBlocks?.length
      ? message.contentBlocks
      : [{ type: "input_text", text: message.content || "" }]
  };
}

function extractResponseText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string") return data.output_text;
  const parts = [];
  const visit = (value) => {
    if (!value) return;
    if (typeof value === "string") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    if ((value.type === "output_text" || value.type === "text") && typeof value.text === "string") {
      parts.push(value.text);
      return;
    }
    if (value.message?.content) visit(value.message.content);
    if (value.content) visit(value.content);
    if (value.output) visit(value.output);
    if (value.choices) visit(value.choices);
  };
  visit(data.output || data.choices || data);
  return parts.join("");
}

function collectResponseMedia(data) {
  const found = [];
  const pushAsset = (asset) => {
    if (!asset?.url && !asset?.content) return;
    found.push({
      id: makeID("asset"),
      name: sanitizeFilename(asset.name || `response-${found.length + 1}`),
      url: asset.url || "",
      content: asset.content || "",
      mimeType: asset.mimeType || "application/octet-stream",
      kind: asset.kind || "file"
    });
  };
  const collectFunctionAsset = (value) => {
    const name = typeof value.name === "string" ? value.name : "";
    if (name !== "create_downloadable_asset") return;
    const argsText = typeof value.arguments === "string"
      ? value.arguments
      : typeof value.input === "string"
        ? value.input
        : "";
    if (!argsText.trim()) return;
    try {
      const args = JSON.parse(argsText);
      if (!args || typeof args !== "object" || typeof args.content !== "string") return;
      pushAsset({
        name: args.filename || "response.txt",
        content: args.content,
        mimeType: args.mimeType || "text/plain;charset=utf-8",
        kind: "file"
      });
    } catch {
      // Ignore malformed tool arguments; the raw response remains available in text.
    }
  };
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const type = String(value.type || "").toLowerCase();
    if (type === "function_call" || type === "custom_tool_call") {
      collectFunctionAsset(value);
    }
    if (type.includes("image_generation") && typeof value.result === "string" && value.result) {
      const result = value.result.startsWith("data:")
        ? value.result
        : `data:image/png;base64,${value.result}`;
      pushAsset({
        name: value.filename || value.name || `image-${found.length + 1}.png`,
        url: result,
        mimeType: dataURLMime(result) || "image/png",
        kind: "image"
      });
    }
    const directURL = typeof value.url === "string" ? value.url : "";
    const imageURL = typeof value.image_url === "string"
      ? value.image_url
      : typeof value.image_url?.url === "string"
        ? value.image_url.url
        : "";
    const fileURL = typeof value.file_url === "string"
      ? value.file_url
      : typeof value.file_url?.url === "string"
        ? value.file_url.url
        : "";
    const url = directURL || imageURL || fileURL;
    if (url && (type.includes("image") || type.includes("file") || imageURL || fileURL)) {
      pushAsset({
        name: sanitizeFilename(value.filename || value.name || `response-${found.length + 1}`),
        url,
        kind: type.includes("image") ? "image" : "file"
      });
    }

    Object.values(value).forEach(visit);
  };
  visit(data?.output || data);
  return found;
}

function PreviewFrame({ content, mode }) {
  const srcDoc = useMemo(
    () => htmlDocumentFromBody(content, mode === "markdown" ? "markdown" : "html"),
    [content, mode]
  );
  return (
    <Box
      component="iframe"
      title={mode === "markdown" ? "Markdown preview" : "HTML preview"}
      sandbox=""
      srcDoc={srcDoc}
      sx={{
        width: "100%",
        minHeight: { xs: 300, md: 380 },
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper"
      }}
    />
  );
}

function AttachmentPreview({ attachment, compact = false, onRemove, onDownload }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        display: "grid",
        gridTemplateColumns: attachment.kind === "image" && !compact ? "64px minmax(0, 1fr) auto" : "minmax(0, 1fr) auto",
        gap: 1,
        alignItems: "center",
        bgcolor: "app.paperAlt"
      }}
    >
      {attachment.kind === "image" && !compact ? (
        <Box
          component="img"
          src={attachment.dataUrl}
          alt={attachment.name}
          sx={{
            width: 64,
            height: 48,
            objectFit: "cover",
            borderRadius: 1,
            border: "1px solid",
            borderColor: "divider"
          }}
        />
      ) : null}
      <Stack spacing={0.35} sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
          {fileIcon(attachment.kind)}
          <Typography variant="body2" noWrap title={attachment.name} sx={{ fontWeight: 680 }}>
            {attachment.name}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap>
          {attachment.type || attachment.kind} · {formatBytes(attachment.size)}
        </Typography>
        {attachment.kind === "audio" && attachment.objectUrl ? (
          <Box component="audio" controls src={attachment.objectUrl} sx={{ width: "100%", mt: 0.5 }} />
        ) : null}
        {attachment.kind === "video" && attachment.objectUrl ? (
          <Box
            component="video"
            controls
            src={attachment.objectUrl}
            sx={{ width: "100%", maxHeight: 180, borderRadius: 1, mt: 0.5, bgcolor: "black" }}
          />
        ) : null}
      </Stack>
      <Stack direction="row" spacing={0.5}>
        <Tooltip title="下载">
          <IconButton size="small" onClick={() => onDownload(attachment)}>
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {onRemove ? (
          <Tooltip title="移除">
            <IconButton size="small" color="error" onClick={() => onRemove(attachment.id)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
    </Paper>
  );
}

function ChatMessage({ message, onCopy, onDownloadAttachment }) {
  const [mode, setMode] = useState(defaultRenderMode(message.content));
  const isAssistant = message.role === "assistant";
  const hasHTML = looksLikeHTML(message.content);
  const canDownloadContent = Boolean(message.content);
  const filenameBase = `sapi-${message.role}-${new Date(message.createdAt).toISOString().replace(/[:.]/g, "-")}`;

  const downloadContent = () => {
    if (!message.content) return;
    if (mode === "html") {
      downloadBlob(message.content, `${filenameBase}.html`, "text/html;charset=utf-8");
      return;
    }
    if (mode === "markdown") {
      downloadBlob(message.content, `${filenameBase}.md`, "text/markdown;charset=utf-8");
      return;
    }
    downloadBlob(message.content, `${filenameBase}.txt`, "text/plain;charset=utf-8");
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 1.25, sm: 1.5 },
        bgcolor: isAssistant ? "background.paper" : "app.paperAlt",
        borderColor: message.error ? "error.main" : "divider"
      }}
    >
      <Stack spacing={1.25}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "stretch", sm: "center" }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip
              size="small"
              color={isAssistant ? "primary" : "default"}
              variant={isAssistant ? "filled" : "outlined"}
              label={isAssistant ? "Assistant" : "You"}
            />
            <Typography variant="caption" color="text.secondary">
              {new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </Typography>
            {message.model ? <Chip size="small" variant="outlined" label={message.model} /> : null}
          </Stack>
          <Stack direction="row" spacing={0.5} justifyContent={{ xs: "flex-start", sm: "flex-end" }} flexWrap="wrap">
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode}
              onChange={(_, next) => next && setMode(next)}
              sx={{ "& .MuiToggleButton-root": { px: 0.9, py: 0.35 } }}
            >
              <ToggleButton value="text" aria-label="文本">
                <Tooltip title="文本">
                  <TextSnippetIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="markdown" aria-label="Markdown">
                <Tooltip title="Markdown">
                  <ArticleIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="html" aria-label="HTML" disabled={!hasHTML}>
                <Tooltip title="HTML">
                  <HtmlIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
            <Tooltip title="复制内容">
              <span>
                <IconButton size="small" disabled={!message.content} onClick={() => onCopy?.(message.content)}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="下载内容">
              <span>
                <IconButton size="small" disabled={!canDownloadContent} onClick={downloadContent}>
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        {message.loading ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              正在生成
            </Typography>
          </Stack>
        ) : null}

        {message.error ? <Alert severity="error">{message.error}</Alert> : null}

        {!message.loading && message.content ? (
          mode === "html" ? (
            <PreviewFrame content={message.content} mode="html" />
          ) : mode === "markdown" ? (
            <PreviewFrame content={message.content} mode="markdown" />
          ) : (
            <Typography
              variant="body2"
              component="pre"
              sx={{
                m: 0,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                fontSize: 13,
                lineHeight: 1.7
              }}
            >
              {message.content}
            </Typography>
          )
        ) : null}

        {message.attachments?.length ? (
          <Stack spacing={1}>
            {message.attachments.map((attachment) => (
              <AttachmentPreview
                key={attachment.id}
                attachment={attachment}
                compact
                onDownload={onDownloadAttachment}
              />
            ))}
          </Stack>
        ) : null}

        {message.assets?.length ? (
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {message.assets.map((asset) => (
              <Button
                key={asset.id}
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => {
                  if (asset.url) {
                    downloadURL(asset.url, asset.name);
                    return;
                  }
                  downloadBlob(asset.content || "", asset.name, asset.mimeType || "application/octet-stream");
                }}
              >
                {asset.name}
              </Button>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}

export function ChatSection({ config, apiKeys = [], selectedKey = "", onToast, onCopy }) {
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const objectUrlsRef = useRef(new Set());
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState("text");
  const [schemaDraft, setSchemaDraft] = useState(DEFAULT_JSON_SCHEMA);
  const [functionDraft, setFunctionDraft] = useState(DEFAULT_FUNCTION_TOOL);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const modelOptions = useMemo(
    () => (config?.models || []).map(normalizeModelFrontend).filter((item) => item.id),
    [config?.models]
  );
  const selectedKeyRecord = useMemo(
    () => apiKeys.find((item) => (item.id || item.key) === apiKeyValue) || null,
    [apiKeys, apiKeyValue]
  );
  const availableModels = useMemo(() => {
    const allowed = selectedKeyRecord?.allowedModels || [];
    if (!allowed.length) return modelOptions;
    const allowedSet = new Set(allowed);
    const filtered = modelOptions.filter((item) => {
      if (allowedSet.has(item.id)) return true;
      for (const allowedModel of allowed) {
        const idx = allowedModel.indexOf("/");
        if (idx > 0 && allowedModel.slice(idx + 1) === item.id) return true;
      }
      return false;
    });
    return filtered.length ? filtered : modelOptions;
  }, [modelOptions, selectedKeyRecord]);

  useEffect(() => {
    if (!apiKeys.length) {
      setApiKeyValue("");
      return;
    }
    const preferred = apiKeys.find((item) => item.key === selectedKey);
    const current = apiKeys.find((item) => (item.id || item.key) === apiKeyValue);
    if (!current) {
      const next = preferred || apiKeys[0];
      setApiKeyValue(next.id || next.key);
    }
  }, [apiKeys, apiKeyValue, selectedKey]);

  useEffect(() => {
    if (!availableModels.length) {
      setModel("");
      return;
    }
    if (!availableModels.some((item) => item.id === model)) {
      setModel(availableModels[0].id);
    }
  }, [availableModels, model]);

  useEffect(() => () => {
    abortRef.current?.abort();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  const registerObjectURL = (url) => {
    if (url) objectUrlsRef.current.add(url);
  };

  const revokeObjectURL = (url) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  };

  const removeAttachment = (id) => {
    setAttachments((current) => {
      const target = current.find((item) => item.id === id);
      revokeObjectURL(target?.objectUrl);
      return current.filter((item) => item.id !== id);
    });
  };

  const downloadAttachment = (attachment) => {
    if (attachment.dataUrl || attachment.objectUrl) {
      downloadURL(attachment.dataUrl || attachment.objectUrl, attachment.name);
      return;
    }
    downloadBlob(attachment.text || "", attachment.name, attachment.type || "text/plain;charset=utf-8");
  };

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    const slots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (!slots) {
      onToast?.(`最多上传 ${MAX_ATTACHMENTS} 个附件`, "warning");
      return;
    }

    const selected = files.slice(0, slots);
    const nextAttachments = [];
    for (const file of selected) {
      const kind = getFileKind(file);
      const limit = kind === "image" ? MAX_IMAGE_BYTES : ["text", "markdown", "html"].includes(kind) ? MAX_TEXT_BYTES : MAX_MEDIA_BYTES;
      if (file.size > limit) {
        onToast?.(`${file.name} 超过 ${formatBytes(limit)}`, "warning");
        continue;
      }

      const item = {
        id: makeID("att"),
        name: file.name,
        type: file.type || kind,
        size: file.size,
        kind
      };

      try {
        if (kind === "image" || kind === "audio") {
          item.dataUrl = await readAsDataURL(file);
        } else if (["text", "markdown", "html"].includes(kind)) {
          item.text = await file.text();
        } else if (kind === "video" || kind === "file") {
          item.dataUrl = await readAsDataURL(file);
          item.objectUrl = URL.createObjectURL(file);
          registerObjectURL(item.objectUrl);
        }
        nextAttachments.push(item);
      } catch (error) {
        onToast?.(`${file.name} 读取失败：${error.message}`, "error");
      }
    }

    if (files.length > selected.length) {
      onToast?.(`已按上限保留前 ${selected.length} 个附件`, "info");
    }
    if (nextAttachments.length) {
      setAttachments((current) => [...current, ...nextAttachments]);
    }
  };

  const clearConversation = () => {
    abortRef.current?.abort();
    setMessages([]);
    setAttachments((current) => {
      current.forEach((item) => revokeObjectURL(item.objectUrl));
      return [];
    });
    setPrompt("");
  };

  const stopRequest = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const submit = async () => {
    const key = selectedKeyRecord?.key || "";
    const trimmed = prompt.trim();
    if (!key) {
      onToast?.("请先创建或选择 API Key", "warning");
      return;
    }
    if (selectedKeyRecord?.enabled === false) {
      onToast?.("当前 API Key 已停用", "warning");
      return;
    }
    if (!model) {
      onToast?.("当前没有可用模型", "warning");
      return;
    }
    if (!trimmed && !attachments.length) {
      onToast?.("请输入内容或上传附件", "warning");
      return;
    }

    const contentBlocks = buildContentBlocks(trimmed, attachments);
    const userMessage = {
      id: makeID("msg"),
      role: "user",
      content: trimmed || attachments.map(attachmentText).join("\n"),
      contentBlocks,
      attachments,
      createdAt: new Date().toISOString(),
      model
    };
    const assistantID = makeID("msg");
    const history = messages.filter((item) => !item.loading && !item.error).slice(-HISTORY_LIMIT + 1);
    const input = [...history.map(messageToResponsesItem), messageToResponsesItem(userMessage)];

    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantID,
        role: "assistant",
        content: "",
        loading: true,
        createdAt: new Date().toISOString(),
        model
      }
    ]);
    setPrompt("");
    setAttachments([]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const requestBody = buildResponseRequest({ model, input, mode, schemaDraft, functionDraft });
      const response = await fetch("/responses", {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Cache-Control": "no-store",
          "Pragma": "no-cache"
        },
        body: JSON.stringify(requestBody)
      });
      const raw = await response.text();
      let data = null;
      if (raw.trim()) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
      }
      if (!response.ok) {
        const message = data?.error?.message || raw.slice(0, 180) || `HTTP ${response.status}`;
        throw new Error(message);
      }

      const content = extractResponseText(data).trim();
      const assets = collectResponseMedia(data);
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantID
            ? {
                ...item,
                loading: false,
                content: content || "（无文本输出）",
                rawResponse: data,
                assets
              }
            : item
        )
      );
    } catch (error) {
      const aborted = error?.name === "AbortError";
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantID
            ? {
                ...item,
                loading: false,
                error: aborted ? "请求已停止" : error.message,
                content: ""
              }
            : item
        )
      );
      if (!aborted) {
        onToast?.(error.message, "error");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  };

  const canSubmit = !loading && Boolean(selectedKeyRecord?.key) && selectedKeyRecord?.enabled !== false && Boolean(model);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "360px minmax(0, 1fr)" },
        gap: 2,
        alignItems: "start"
      }}
    >
      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, position: { lg: "sticky" }, top: { lg: 88 } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: 1,
                bgcolor: "app.paperAlt",
                border: "1px solid",
                borderColor: "divider",
                display: "grid",
                placeItems: "center",
                color: "text.secondary",
                "& svg": { fontSize: 17 }
              }}
            >
              <ChatBubbleOutlineIcon />
            </Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              站内 Chat
            </Typography>
          </Stack>

          <FormControl size="small" fullWidth>
            <InputLabel id="chat-key-label">API Key</InputLabel>
            <Select
              labelId="chat-key-label"
              label="API Key"
              value={apiKeyValue}
              onChange={(event) => setApiKeyValue(event.target.value)}
            >
              {apiKeys.map((key) => (
                <MenuItem key={key.id || key.key} value={key.id || key.key}>
                  {key.name || "API Key"} · {key.preview || key.key?.slice(0, 12) || "-"}{key.enabled === false ? " · 停用" : ""}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel id="chat-model-label">模型</InputLabel>
            <Select
              labelId="chat-model-label"
              label="模型"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {availableModels.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.name || item.id}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel id="chat-mode-label">能力</InputLabel>
            <Select
              labelId="chat-mode-label"
              label="能力"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              {CHAT_MODES.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {mode === "json_schema" ? (
            <TextField
              label="JSON Schema"
              value={schemaDraft}
              onChange={(event) => setSchemaDraft(event.target.value)}
              multiline
              minRows={6}
              fullWidth
            />
          ) : null}

          {mode === "function" ? (
            <TextField
              label="Function Tool"
              value={functionDraft}
              onChange={(event) => setFunctionDraft(event.target.value)}
              multiline
              minRows={6}
              fullWidth
            />
          ) : null}

          <TextField
            label="消息"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            minRows={7}
            multiline
            fullWidth
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />

          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept="image/*,audio/*,video/*,application/pdf,.pdf,.txt,.md,.markdown,.html,.htm,.json,.csv,.xml,.yaml,.yml,.log,.js,.jsx,.ts,.tsx,.css,.go,.py,.java,.rs,.sh,.sql"
            onChange={handleFiles}
          />

          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              variant="outlined"
              startIcon={<AttachFileIcon />}
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || attachments.length >= MAX_ATTACHMENTS}
            >
              上传
            </Button>
            {loading ? (
              <Button variant="outlined" color="error" startIcon={<StopCircleIcon />} onClick={stopRequest}>
                停止
              </Button>
            ) : (
              <Button variant="contained" startIcon={<SendIcon />} onClick={submit} disabled={!canSubmit}>
                发送
              </Button>
            )}
            <Tooltip title="清空会话">
              <span>
                <IconButton disabled={loading && !messages.length} onClick={clearConversation}>
                  <ClearIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          {!apiKeys.length ? <Alert severity="info">当前账号还没有 API Key。</Alert> : null}
          {selectedKeyRecord?.enabled === false ? <Alert severity="warning">当前 API Key 已停用。</Alert> : null}

          {attachments.length ? (
            <Stack spacing={1}>
              {attachments.map((attachment) => (
                <AttachmentPreview
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={removeAttachment}
                  onDownload={downloadAttachment}
                />
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, minHeight: 520 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <CodeIcon color="action" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Responses 会话
              </Typography>
            </Stack>
            {loading ? <CircularProgress size={18} /> : null}
          </Stack>

          {messages.length ? (
            <Stack spacing={1.5}>
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onCopy={onCopy}
                  onDownloadAttachment={downloadAttachment}
                />
              ))}
            </Stack>
          ) : (
            <EmptyState text="还没有消息。" />
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
