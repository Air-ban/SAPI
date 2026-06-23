import React, { useEffect, useRef, useState } from "react";
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
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ClearIcon from "@mui/icons-material/Clear";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import ImageIcon from "@mui/icons-material/Image";
import LayersIcon from "@mui/icons-material/Layers";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import { EmptyState } from "../components/EmptyState";
import { wsProxyRequest } from "../utils/wsProxy";

const MAX_REFERENCE_IMAGES = 8;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const RESULT_LIMIT = 30;
const NOVELAI_IMAGE_BASE_URL = "https://image.novelai.net";
const NOVELAI_DEFAULT_NEGATIVE_PROMPT = "lowres, bad anatomy, bad hands, text, error, missing fingers, cropped, worst quality, low quality";
const NOVELAI_SIZE_CAP = 1536;

const NOVELAI_MODELS = [
  { id: "nai-diffusion-4-5-curated", name: "NovelAI Diffusion V4.5 Curated" },
  { id: "nai-diffusion-4-5-full", name: "NovelAI Diffusion V4.5 Full" },
  { id: "nai-diffusion-4-curated-preview", name: "NovelAI Diffusion V4 Curated Preview" },
  { id: "nai-diffusion-4-full", name: "NovelAI Diffusion V4 Full" },
  { id: "nai-diffusion-3", name: "NovelAI Diffusion Anime V3" },
  { id: "nai-diffusion-2", name: "NovelAI Diffusion Anime V2" },
  { id: "nai-diffusion", name: "NovelAI Diffusion Anime V1" },
  { id: "safe-diffusion", name: "NovelAI Diffusion Safe" },
  { id: "nai-diffusion-furry-3", name: "NovelAI Diffusion Furry V3" },
  { id: "nai-diffusion-furry", name: "NovelAI Diffusion Furry" },
  { id: "nai-diffusion-4-5-curated-inpainting", name: "NovelAI V4.5 Curated Inpainting" },
  { id: "nai-diffusion-4-5-full-inpainting", name: "NovelAI V4.5 Full Inpainting" },
  { id: "nai-diffusion-4-curated-preview-inpainting", name: "NovelAI V4 Curated Inpainting" },
  { id: "nai-diffusion-4-full-inpainting", name: "NovelAI V4 Full Inpainting" },
  { id: "nai-diffusion-3-inpainting", name: "NovelAI Anime V3 Inpainting" },
  { id: "nai-diffusion-inpainting", name: "NovelAI Anime V1 Inpainting" },
  { id: "safe-diffusion-inpainting", name: "NovelAI Safe Inpainting" },
  { id: "furry-diffusion-inpainting", name: "NovelAI Furry Inpainting" },
  { id: "kandinsky-vanilla", name: "Kandinsky Vanilla" }
];

const NOVELAI_SAMPLERS = [
  { id: "k_euler_ancestral", name: "Euler Ancestral" },
  { id: "k_euler", name: "Euler" },
  { id: "k_dpmpp_2m", name: "DPM++ 2M" },
  { id: "k_dpmpp_2s_ancestral", name: "DPM++ 2S Ancestral" },
  { id: "k_dpmpp_sde", name: "DPM++ SDE" },
  { id: "ddim_v3", name: "DDIM V3" }
];

const SIZE_PRESETS = {
  "1K": {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "16:9": "1280x720",
    "9:16": "720x1280",
    "4:3": "1024x768",
    "3:4": "768x1024"
  },
  "2K": {
    "1:1": "2048x2048",
    "3:2": "2160x1440",
    "2:3": "1440x2160",
    "16:9": "2560x1440",
    "9:16": "1440x2560",
    "4:3": "2048x1536",
    "3:4": "1536x2048"
  },
  "4K": {
    "1:1": "2880x2880",
    "3:2": "3456x2304",
    "2:3": "2304x3456",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
    "4:3": "3200x2400",
    "3:4": "2400x3200"
  }
};

const MIME_BY_FORMAT = {
  png: "image/png",
  webp: "image/webp"
};

const glassPanelSx = {
  position: "relative",
  overflow: "hidden",
  borderColor: "app.glassBorder",
  background: (theme) => theme.palette.app.glassStrong,
  boxShadow: (theme) => theme.palette.app.softShadow,
  "&::before": {
    content: '""',
    position: "absolute",
    inset: "0 0 auto 0",
    height: 1,
    bgcolor: "app.glassEdge",
    opacity: 0.8,
    pointerEvents: "none"
  }
};

const controlIconSx = {
  width: 32,
  height: 32,
  borderRadius: 1,
  bgcolor: "app.accentSoftRose",
  border: "1px solid",
  borderColor: "app.glassBorder",
  display: "grid",
  placeItems: "center",
  color: "app.accentRose",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.42)",
  "& svg": { fontSize: 18 }
};

function makeID(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function sanitizeFilename(name) {
  return String(name || "sapi-nai-image")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "sapi-nai-image";
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function dataURLToBase64(dataUrl) {
  const [, payload = ""] = String(dataUrl || "").split(",");
  return payload.trim();
}

function normalizeImageValue(value, fallbackMime = "image/png") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^data:image\//i.test(text) || /^https?:\/\//i.test(text)) return text;
  return `data:${fallbackMime};base64,${text}`;
}

function downloadURL(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = sanitizeFilename(filename);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadText(content, filename, mime = "application/json;charset=utf-8") {
  const blob = new Blob([content || ""], { type: mime });
  const url = URL.createObjectURL(blob);
  downloadURL(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function imageExtension(url, fallbackFormat) {
  if (String(url).startsWith("data:image/webp")) return "webp";
  if (String(url).startsWith("data:image/jpeg")) return "jpg";
  if (/\.webp($|\?)/i.test(url)) return "webp";
  if (/\.jpe?g($|\?)/i.test(url)) return "jpg";
  return fallbackFormat === "webp" ? "webp" : "png";
}

function requestSize(tier, ratio, customSize) {
  if (tier === "custom") return customSize.trim() || "1024x1024";
  return SIZE_PRESETS[tier]?.[ratio] || "1024x1024";
}

function parseSizeValue(value, fallback = "1024x1024") {
  const match = String(value || "").match(/(\d{2,5})\s*[xX*]\s*(\d{2,5})/);
  if (!match) return parseSizeValue(fallback, "1024x1024");
  return {
    width: Number(match[1]) || 1024,
    height: Number(match[2]) || 1024
  };
}

function novelAISize(sizeValue) {
  const parsed = parseSizeValue(sizeValue);
  const scale = Math.min(1, NOVELAI_SIZE_CAP / Math.max(parsed.width, parsed.height));
  const round64 = (value) => Math.max(64, Math.round((value * scale) / 64) * 64);
  return {
    width: round64(parsed.width),
    height: round64(parsed.height)
  };
}

function novelAICorrelationID() {
  return Math.random().toString(36).replace(/[^a-z0-9]/gi, "").slice(2, 8).padEnd(6, "0");
}

function novelAIUsesV4Prompt(model) {
  return /^nai-diffusion-4/i.test(String(model || ""));
}

function resultKey(result) {
  return result.url || result.revisedPrompt || result.id;
}

function collectImagesFromPayload(payload, fallbackMime) {
  const found = [];
  const seen = new Set();
  const push = (value, meta = {}) => {
    const url = normalizeImageValue(value, fallbackMime);
    if (!url || seen.has(url)) return;
    seen.add(url);
    found.push({
      id: makeID("img"),
      url,
      revisedPrompt: meta.revisedPrompt || "",
      actualParams: meta.actualParams || {}
    });
  };

  const visit = (value, inherited = {}) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, inherited));
      return;
    }

    const meta = {
      revisedPrompt: typeof value.prompt === "string" ? value.prompt : inherited.revisedPrompt || "",
      actualParams: inherited.actualParams || {}
    };

    if (typeof value.b64_json === "string") push(value.b64_json, meta);
    if (typeof value.base64 === "string") push(value.base64, meta);
    if (typeof value.image === "string") push(value.image, meta);
    if (typeof value.url === "string") push(value.url, meta);
    if (typeof value.image_url === "string") push(value.image_url, meta);
    if (typeof value.file_url === "string") push(value.file_url, meta);

    for (const key of ["data", "images", "output", "result", "content"]) {
      if (value[key]) visit(value[key], meta);
    }
  };

  visit(payload);
  return found;
}

function buildNovelAIImageBody({
  model,
  prompt,
  params,
  referenceImages,
  maskImage,
  negativePrompt,
  sampler,
  steps,
  scale,
  seed
}) {
  const imageSize = novelAISize(params.size);
  const hasImage = referenceImages.length > 0;
  const action = maskImage ? "infill" : hasImage ? "img2img" : "generate";
  const cleanNegativePrompt = negativePrompt.trim() || NOVELAI_DEFAULT_NEGATIVE_PROMPT;
  const parameters = {
    ...imageSize,
    prompt,
    negative_prompt: cleanNegativePrompt,
    sampler,
    steps,
    scale,
    n_samples: Math.max(1, Math.min(4, Number(params.n || 1))),
    image_format: params.outputFormat === "webp" ? "webp" : "png",
    qualityToggle: true,
    ucPreset: 0,
    seed: seed > 0 ? seed : Math.floor(Math.random() * 4294967295),
    stream: "sse"
  };

  if (novelAIUsesV4Prompt(model)) {
    parameters.v4_prompt = {
      caption: { base_caption: prompt, char_captions: [] },
      use_coords: false,
      use_order: true,
      legacy_uc: false
    };
    parameters.v4_negative_prompt = {
      caption: { base_caption: cleanNegativePrompt, char_captions: [] },
      use_coords: false,
      use_order: true,
      legacy_uc: false
    };
  }

  if (hasImage) {
    parameters.image = dataURLToBase64(referenceImages[0].dataUrl);
    parameters.strength = 0.7;
    parameters.noise = 0.1;
  }
  if (maskImage?.dataUrl) {
    parameters.mask = dataURLToBase64(maskImage.dataUrl);
  }

  return {
    action,
    input: prompt,
    model,
    parameters
  };
}

function parseSSEDataEvents(raw) {
  const events = [];
  let dataLines = [];
  const flush = () => {
    if (!dataLines.length) return;
    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (data) events.push(data);
  };

  String(raw || "").replace(/\r\n/g, "\n").split("\n").forEach((line) => {
    if (!line.trim()) {
      flush();
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  });
  flush();
  return events;
}

function parseNovelAIStream(raw, fallbackMime = "image/png") {
  const payloads = [];
  let error = "";
  const eventTexts = parseSSEDataEvents(raw);
  const candidates = eventTexts.length ? eventTexts : [String(raw || "").trim()].filter(Boolean);
  for (const eventText of candidates) {
    if (eventText === "[DONE]") continue;
    try {
      const event = JSON.parse(eventText);
      payloads.push(event);
      if (event?.error) {
        error = typeof event.error === "string" ? event.error : event.error.message || JSON.stringify(event.error);
      }
    } catch {
      payloads.push({ raw: eventText });
    }
  }
  const images = collectImagesFromPayload(payloads, fallbackMime);
  return { payloads, images, error };
}

function ImageTile({ result, index, outputFormat, onCopy, onUseAsReference }) {
  const filename = `sapi-nai-image-${index + 1}.${imageExtension(result.url, outputFormat)}`;
  return (
    <Paper
      variant="outlined"
      sx={{
        overflow: "hidden",
        position: "relative",
        background: (theme) => theme.palette.app.glass,
        borderColor: "app.glassBorder",
        boxShadow: (theme) => theme.palette.app.softShadow,
        display: "flex",
        flexDirection: "column"
      }}
    >
      <Box
        component="img"
        src={result.url}
        alt={result.revisedPrompt || `生成图片 ${index + 1}`}
        sx={{
          width: "100%",
          aspectRatio: "1 / 1",
          objectFit: "contain",
          bgcolor: "rgba(0,0,0,0.04)",
          borderBottom: "1px solid",
          borderColor: "divider"
        }}
      />
      <Stack spacing={1} sx={{ p: 1.25 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
          <Chip size="small" label={`图 ${index + 1}`} />
          {result.actualParams?.size ? <Chip size="small" variant="outlined" label={result.actualParams.size} /> : null}
        </Stack>
        {result.revisedPrompt ? (
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-word" }}>
            {result.revisedPrompt}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={0.5} flexWrap="wrap">
          <Tooltip title="下载图片">
            <IconButton size="small" onClick={() => downloadURL(result.url, filename)}>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="复制图片数据">
            <IconButton size="small" onClick={() => onCopy?.(result.url)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="打开图片">
            <IconButton size="small" onClick={() => window.open(result.url, "_blank", "noopener,noreferrer")}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button size="small" variant="outlined" startIcon={<AddPhotoAlternateIcon />} onClick={() => onUseAsReference(result)}>
            参考
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function ReferenceImageStrip({ images, maskImage, onRemove, onClearMask }) {
  if (!images.length && !maskImage) return null;
  return (
    <Stack spacing={1}>
      {images.length ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 1 }}>
          {images.map((image, index) => (
            <Box key={image.id} sx={{ position: "relative" }}>
              <Box
                component="img"
                src={image.dataUrl}
                alt={`参考图 ${index + 1}`}
                sx={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  objectFit: "cover",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "app.glassBorder",
                  bgcolor: "app.paperAlt",
                  boxShadow: (theme) => theme.palette.app.softShadow
                }}
              />
              <IconButton
                size="small"
                onClick={() => onRemove(image.id)}
                sx={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  bgcolor: "rgba(0,0,0,0.58)",
                  color: "#fff",
                  "&:hover": { bgcolor: "rgba(0,0,0,0.72)" }
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
      ) : null}
      {maskImage ? (
        <Paper
          variant="outlined"
          sx={{
            p: 1,
            display: "flex",
            alignItems: "center",
            gap: 1,
            borderColor: "app.glassBorder",
            background: (theme) => theme.palette.app.glass
          }}
        >
          <Box component="img" src={maskImage.dataUrl} alt="遮罩" sx={{ width: 42, height: 42, objectFit: "cover", borderRadius: 1 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 680 }}>{maskImage.name}</Typography>
            <Typography variant="caption" color="text.secondary">{formatBytes(maskImage.size)}</Typography>
          </Box>
          <IconButton size="small" onClick={onClearMask}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Paper>
      ) : null}
    </Stack>
  );
}

export function NovelAIImageSection({ onToast, onCopy }) {
  const referenceInputRef = useRef(null);
  const maskInputRef = useRef(null);
  const abortRef = useRef(null);
  const [novelAIKey, setNovelAIKey] = useState("");
  const [model, setModel] = useState(NOVELAI_MODELS[0].id);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(NOVELAI_DEFAULT_NEGATIVE_PROMPT);
  const [sampler, setSampler] = useState("k_euler_ancestral");
  const [steps, setSteps] = useState(28);
  const [scale, setScale] = useState(5);
  const [seed, setSeed] = useState("");
  const [tier, setTier] = useState("1K");
  const [ratio, setRatio] = useState("1:1");
  const [customSize, setCustomSize] = useState("1024x1024");
  const [outputFormat, setOutputFormat] = useState("png");
  const [count, setCount] = useState(1);
  const [referenceImages, setReferenceImages] = useState([]);
  const [maskImage, setMaskImage] = useState(null);
  const [results, setResults] = useState([]);
  const [rawResponse, setRawResponse] = useState("");
  const [loading, setLoading] = useState(false);

  const size = requestSize(tier, ratio, customSize);
  const params = {
    size,
    outputFormat,
    n: Number(count || 1)
  };
  const canSubmit = !loading && Boolean(novelAIKey.trim());

  useEffect(() => () => abortRef.current?.abort(), []);

  const readImageFiles = async (files, { mask = false } = {}) => {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!selected.length) return;
    const next = [];
    for (const file of selected) {
      if (file.size > MAX_IMAGE_BYTES) {
        onToast?.(`${file.name} 超过 ${formatBytes(MAX_IMAGE_BYTES)}`, "warning");
        continue;
      }
      try {
        next.push({
          id: makeID(mask ? "mask" : "ref"),
          name: file.name,
          size: file.size,
          type: file.type || "image/png",
          dataUrl: await readAsDataURL(file)
        });
      } catch (error) {
        onToast?.(`${file.name} 读取失败：${error.message}`, "error");
      }
    }
    if (!next.length) return;
    if (mask) {
      setMaskImage(next[0]);
      return;
    }
    setReferenceImages((current) => {
      const slots = Math.max(0, MAX_REFERENCE_IMAGES - current.length);
      if (next.length > slots) onToast?.(`最多保留 ${MAX_REFERENCE_IMAGES} 张参考图`, "info");
      return [...current, ...next.slice(0, slots)];
    });
  };

  const submit = async () => {
    const key = novelAIKey.trim();
    const cleanPrompt = prompt.trim();
    if (!key) {
      onToast?.("请输入 NovelAI Persistent API Token", "warning");
      return;
    }
    if (!model.trim()) {
      onToast?.("请选择模型", "warning");
      return;
    }
    if (!cleanPrompt) {
      onToast?.("请输入提示词", "warning");
      return;
    }
    if (maskImage && !referenceImages.length) {
      onToast?.("遮罩需要配合参考图使用", "warning");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setRawResponse("");

    try {
      const startedAt = Date.now();
      const body = buildNovelAIImageBody({
        model: model.trim(),
        prompt: cleanPrompt,
        params,
        referenceImages,
        maskImage,
        negativePrompt,
        sampler,
        steps,
        scale,
        seed: Number(seed || 0)
      });
      const response = await wsProxyRequest({
        url: `${NOVELAI_IMAGE_BASE_URL}/ai/generate-image-stream`,
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "text/event-stream",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "X-Correlation-Id": novelAICorrelationID()
        },
        body
      });
      const raw = await response.text();
      if (!response.ok) {
        let payload = null;
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = null;
        }
        throw new Error(payload?.message || payload?.error?.message || raw.slice(0, 240) || `HTTP ${response.status}`);
      }
      const fallbackMime = MIME_BY_FORMAT[body.parameters.image_format] || "image/png";
      const parsed = parseNovelAIStream(raw, fallbackMime);
      if (parsed.error) throw new Error(parsed.error);
      if (!parsed.images.length) {
        setRawResponse(raw);
        throw new Error("接口没有返回可识别的图片数据");
      }
      const record = {
        id: makeID("run"),
        prompt: cleanPrompt,
        model: model.trim(),
        params: {
          ...params,
          size: `${body.parameters.width}x${body.parameters.height}`,
          outputFormat: body.parameters.image_format
        },
        createdAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        images: parsed.images
      };
      setResults((current) => [record, ...current].slice(0, RESULT_LIMIT));
      setRawResponse(raw);
    } catch (error) {
      if (error?.name === "AbortError") {
        onToast?.("请求已停止", "info");
      } else {
        onToast?.(error.message, "error");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const useResultAsReference = (result) => {
    if (!String(result.url).startsWith("data:image/")) {
      onToast?.("URL 图片可打开保存后再作为参考图上传", "info");
      return;
    }
    setReferenceImages((current) => {
      if (current.length >= MAX_REFERENCE_IMAGES) return current;
      return [
        ...current,
        {
          id: makeID("ref"),
          name: "generated-reference.png",
          size: result.url.length,
          type: result.url.match(/^data:([^;]+)/)?.[1] || "image/png",
          dataUrl: result.url
        }
      ];
    });
  };

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "360px minmax(0, 1fr)" },
        gap: { xs: 1.5, lg: 2.25 },
        alignItems: "start"
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          ...glassPanelSx,
          p: { xs: 1.5, sm: 2 },
          position: { lg: "sticky" },
          top: { lg: 88 }
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box sx={controlIconSx}>
              <AutoAwesomeIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 720 }}>
                NovelAI 生图
              </Typography>
              <Typography variant="caption" color="text.secondary">
                image.novelai.net
              </Typography>
            </Box>
          </Stack>

          <TextField
            label="Persistent API Token"
            size="small"
            type="password"
            value={novelAIKey}
            onChange={(event) => setNovelAIKey(event.target.value)}
            fullWidth
            autoComplete="off"
          />

          <FormControl size="small" fullWidth>
            <InputLabel id="novelai-model-label">模型</InputLabel>
            <Select
              labelId="novelai-model-label"
              label="模型"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {NOVELAI_MODELS.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="提示词"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            minRows={6}
            multiline
            fullWidth
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />

          <TextField
            label="负面提示词"
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
            minRows={2}
            multiline
            fullWidth
          />

          <FormControl size="small" fullWidth>
            <InputLabel id="novelai-sampler-label">采样器</InputLabel>
            <Select
              labelId="novelai-sampler-label"
              label="采样器"
              value={sampler}
              onChange={(event) => setSampler(event.target.value)}
            >
              {NOVELAI_SAMPLERS.map((item) => (
                <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box>
            <Typography variant="caption" color="text.secondary">
              步数 {steps}
            </Typography>
            <Slider size="small" min={1} max={50} value={steps} onChange={(_, value) => setSteps(Number(value))} />
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary">
              CFG {scale}
            </Typography>
            <Slider size="small" min={1} max={12} step={0.5} value={scale} onChange={(_, value) => setScale(Number(value))} />
          </Box>

          <TextField
            label="Seed"
            size="small"
            type="number"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            fullWidth
          />

          <Stack direction="row" spacing={1}>
            <FormControl size="small" fullWidth>
              <InputLabel id="novelai-tier-label">档位</InputLabel>
              <Select labelId="novelai-tier-label" label="档位" value={tier} onChange={(event) => setTier(event.target.value)}>
                <MenuItem value="1K">1K</MenuItem>
                <MenuItem value="2K">2K</MenuItem>
                <MenuItem value="4K">4K</MenuItem>
                <MenuItem value="custom">自定义</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth disabled={tier === "custom"}>
              <InputLabel id="novelai-ratio-label">比例</InputLabel>
              <Select labelId="novelai-ratio-label" label="比例" value={ratio} onChange={(event) => setRatio(event.target.value)}>
                {Object.keys(SIZE_PRESETS["1K"]).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>

          {tier === "custom" ? (
            <TextField
              label="尺寸"
              size="small"
              value={customSize}
              onChange={(event) => setCustomSize(event.target.value)}
              fullWidth
            />
          ) : (
            <Chip size="small" icon={<LayersIcon />} label={novelAISize(size).width + "x" + novelAISize(size).height} sx={{ alignSelf: "flex-start" }} />
          )}

          <Stack direction="row" spacing={1}>
            <FormControl size="small" fullWidth>
              <InputLabel id="novelai-format-label">格式</InputLabel>
              <Select labelId="novelai-format-label" label="格式" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value)}>
                <MenuItem value="png">PNG</MenuItem>
                <MenuItem value="webp">WebP</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel id="novelai-count-label">数量</InputLabel>
              <Select labelId="novelai-count-label" label="数量" value={count} onChange={(event) => setCount(Number(event.target.value))}>
                {[1, 2, 3, 4].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>

          <input
            ref={referenceInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              readImageFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={maskInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              readImageFiles(event.target.files, { mask: true });
              event.target.value = "";
            }}
          />

          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              variant="outlined"
              startIcon={<AddPhotoAlternateIcon />}
              disabled={loading || referenceImages.length >= MAX_REFERENCE_IMAGES}
              onClick={() => referenceInputRef.current?.click()}
            >
              参考图
            </Button>
            <Button
              variant="outlined"
              startIcon={<ImageIcon />}
              disabled={loading}
              onClick={() => maskInputRef.current?.click()}
            >
              遮罩
            </Button>
            {loading ? (
              <Button variant="outlined" color="error" startIcon={<StopCircleIcon />} onClick={stop}>
                停止
              </Button>
            ) : (
              <Button variant="contained" startIcon={<AutoAwesomeIcon />} disabled={!canSubmit} onClick={submit}>
                生成
              </Button>
            )}
            <Tooltip title="清空输入">
              <span>
                <IconButton
                  disabled={loading}
                  onClick={() => {
                    setPrompt("");
                    setReferenceImages([]);
                    setMaskImage(null);
                  }}
                >
                  <ClearIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <Alert severity="info">
            NAI Token 仅通过本页代理转发到 NovelAI，不写入 SAPI 后端。
          </Alert>

          <ReferenceImageStrip
            images={referenceImages}
            maskImage={maskImage}
            onRemove={(id) => setReferenceImages((current) => current.filter((item) => item.id !== id))}
            onClearMask={() => setMaskImage(null)}
          />
        </Stack>
      </Paper>

      <Paper
        variant="outlined"
        sx={{
          ...glassPanelSx,
          p: { xs: 1.5, sm: 2 },
          minHeight: 560
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ ...controlIconSx, color: "app.accentCyan", bgcolor: "app.accentSoftCyan" }}>
                <ImageIcon />
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                生成结果
              </Typography>
              {loading ? <CircularProgress size={18} /> : null}
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                disabled={!results[0]?.images?.length}
                onClick={() => {
                  results[0]?.images?.forEach((image, index) => {
                    downloadURL(image.url, `sapi-nai-image-${index + 1}.${imageExtension(image.url, outputFormat)}`);
                  });
                }}
              >
                下载本轮
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopyIcon />}
                disabled={!rawResponse}
                onClick={() => onCopy?.(rawResponse)}
              >
                原始响应
              </Button>
            </Stack>
          </Stack>

          {results.length ? (
            <Stack spacing={2}>
              {results.map((run) => (
                <Box key={run.id} sx={{ display: "grid", gap: 1.25 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                    <Chip size="small" label="NovelAI" />
                    <Chip size="small" variant="outlined" label={run.model} />
                    <Chip size="small" variant="outlined" label={run.params.size} />
                    <Chip size="small" variant="outlined" label={`${Math.max(1, Math.round(run.elapsedMs / 100) / 10)}s`} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                    {run.prompt}
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
                      gap: 1.5
                    }}
                  >
                    {run.images.map((image, index) => (
                      <ImageTile
                        key={resultKey(image)}
                        result={image}
                        index={index}
                        outputFormat={run.params.outputFormat}
                        onCopy={onCopy}
                        onUseAsReference={useResultAsReference}
                      />
                    ))}
                  </Box>
                </Box>
              ))}
            </Stack>
          ) : (
            <EmptyState text={loading ? "正在生成。" : "还没有图片。"} />
          )}

          {rawResponse ? (
            <Button
              size="small"
              variant="text"
              sx={{ alignSelf: "flex-start" }}
              onClick={() => downloadText(rawResponse, "sapi-nai-response.json")}
            >
              下载原始响应
            </Button>
          ) : null}
        </Stack>
      </Paper>
    </Box>
  );
}
