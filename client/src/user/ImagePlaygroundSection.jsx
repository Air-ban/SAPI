import React, { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ImageIcon from "@mui/icons-material/Image";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import { EmptyState } from "../components/EmptyState";
import { NovelAIImageSection } from "./NovelAIImageSection";
import { modelDisplayParts } from "../utils/helpers";

const PLAYGROUND_PATH = "/image-playground/";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";

function imageModelScore(model) {
  const text = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  if (!text) return 0;
  if (text.includes("gpt-image")) return 100;
  if (text.includes("nai-diffusion")) return 95;
  if (text.includes("diffusion")) return 90;
  if (text.includes("image")) return 80;
  if (text.includes("sdxl") || text.includes("stable-diffusion")) return 75;
  if (text.includes("flux")) return 70;
  if (text.includes("dall")) return 60;
  return 0;
}

function isImageModel(model) {
  return imageModelScore(model) > 0;
}

function modelId(model) {
  if (!model) return "";
  return typeof model === "string" ? model : model.id || model.name || "";
}

function modelLabel(model) {
  const parts = modelDisplayParts(model);
  return parts.displayName;
}

function pickDefaultModel(models) {
  const list = (models || []).filter(isImageModel);
  const imageModel = [...list].sort((a, b) => imageModelScore(b) - imageModelScore(a))[0];
  return modelId(imageModel);
}

function keyRecordId(record) {
  return record?.id || record?.key || "";
}

function modelMatchesRule(rule, requestedModel) {
  const allowed = String(rule || "").trim();
  const requested = String(requestedModel || "").trim();
  if (!allowed || !requested) return false;
  if (allowed === requested) return true;

  const allowedIndex = allowed.indexOf("/");
  const requestedIndex = requested.indexOf("/");
  const allowedInner = allowedIndex > 0 ? allowed.slice(allowedIndex + 1) : "";
  const requestedInner = requestedIndex > 0 ? requested.slice(requestedIndex + 1) : "";

  if (requestedInner && allowed === requestedInner) return true;
  return Boolean(allowedInner && requested === allowedInner);
}

function buildPlaygroundURL({ apiKey, model, nonce }) {
  const url = new URL(PLAYGROUND_PATH, window.location.origin);
  url.searchParams.set("apiUrl", `${window.location.origin.replace(/\/+$/, "")}/v1`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("apiMode", "images");
  url.searchParams.set("model", model || DEFAULT_IMAGE_MODEL);
  url.searchParams.set("profileName", "SAPI");
  url.searchParams.set("streamImages", "false");
  url.searchParams.set("streamPartialImages", "0");
  url.searchParams.set("embed", "sapi");
  if (nonce) url.searchParams.set("_", String(nonce));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function ImagePlaygroundSection({ config, apiKeys = [], selectedKey = "", onToast, onCopy }) {
  const [module, setModule] = useState("gpt");
  const enabledKeys = useMemo(
    () => apiKeys.filter((item) => item?.enabled !== false && item?.key),
    [apiKeys]
  );
  const [selectedKeyId, setSelectedKeyId] = useState(() => {
    const preferred = enabledKeys.find((item) => item.key === selectedKey);
    return keyRecordId(preferred || enabledKeys[0]);
  });
  const [selectedModel, setSelectedModel] = useState(() => pickDefaultModel(config?.models));
  const [reloadNonce, setReloadNonce] = useState(0);

  const activeKey = useMemo(
    () => enabledKeys.find((item) => keyRecordId(item) === selectedKeyId) || enabledKeys[0] || null,
    [enabledKeys, selectedKeyId]
  );
  const modelOptions = useMemo(() => {
    const allowed = activeKey?.allowedModels || [];
    const models = (config?.models || []).filter(Boolean);
    const allowedModels = !allowed.length ? models : models.filter((item) => {
      const id = modelId(item);
      return allowed.some((allowedModel) => modelMatchesRule(allowedModel, id));
    });
    return allowedModels.filter(isImageModel);
  }, [activeKey, config?.models]);

  const selectedModelAvailable = modelOptions.some((item) => modelId(item) === selectedModel);
  const effectiveModel = selectedModelAvailable ? selectedModel : pickDefaultModel(modelOptions);
  const playgroundURL = activeKey?.key && effectiveModel
    ? buildPlaygroundURL({
        apiKey: activeKey.key,
        model: effectiveModel,
        nonce: reloadNonce
      })
    : "";

  const refresh = () => setReloadNonce((value) => value + 1);
  const openExternal = () => {
    if (!playgroundURL) return;
    window.open(playgroundURL, "_blank", "noopener,noreferrer");
  };

  return (
    <Stack spacing={1.5}>
      <Paper
        variant="outlined"
        sx={{
          p: 1,
          bgcolor: "app.paperAlt",
          borderColor: "app.glassBorder"
        }}
      >
        <ToggleButtonGroup
          exclusive
          value={module}
          onChange={(_, value) => {
            if (value) setModule(value);
          }}
          size="small"
          sx={{
            flexWrap: "wrap",
            gap: 0.75,
            "& .MuiToggleButtonGroup-grouped": {
              borderRadius: "7px !important",
              borderLeft: "1px solid",
              borderColor: "app.glassBorder",
              px: 1.25
            }
          }}
        >
          <ToggleButton value="gpt" aria-label="GPT Image Playground">
            <Stack direction="row" spacing={0.75} alignItems="center">
              <ImageIcon fontSize="small" />
              <span>GPT 工坊</span>
            </Stack>
          </ToggleButton>
          <ToggleButton value="novelai" aria-label="NovelAI 生图">
            <Stack direction="row" spacing={0.75} alignItems="center">
              <AutoAwesomeIcon fontSize="small" />
              <span>NovelAI</span>
            </Stack>
          </ToggleButton>
        </ToggleButtonGroup>
      </Paper>

      {module === "novelai" ? (
        <NovelAIImageSection onToast={onToast} onCopy={onCopy} />
      ) : enabledKeys.length ? (
        <>
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          bgcolor: "app.paperAlt",
          borderColor: "app.glassBorder"
        }}
      >
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ xs: "stretch", md: "center" }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                display: "grid",
                placeItems: "center",
                borderRadius: 1,
                bgcolor: "app.primarySoft",
                color: "primary.main",
                flexShrink: 0
              }}
            >
              <ImageIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 760 }}>
                GPT Image Playground
              </Typography>
              <Typography variant="caption" color="text.secondary">
                使用当前 SAPI Base URL 和 API Key 调用 `/v1/images/*`。
              </Typography>
            </Box>
          </Stack>

          <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 220 } }}>
            <InputLabel id="image-workbench-key-label">API Key</InputLabel>
            <Select
              labelId="image-workbench-key-label"
              label="API Key"
              value={keyRecordId(activeKey)}
              onChange={(event) => setSelectedKeyId(event.target.value)}
            >
              {enabledKeys.map((item) => (
                <MenuItem key={keyRecordId(item)} value={keyRecordId(item)}>
                  {item.name || "API Key"}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 260 } }} disabled={!modelOptions.length}>
            <InputLabel id="image-workbench-model-label">默认模型</InputLabel>
            <Select
              labelId="image-workbench-model-label"
              label="默认模型"
              value={effectiveModel || ""}
              onChange={(event) => setSelectedModel(event.target.value)}
            >
              {modelOptions.length ? (
                modelOptions.map((item) => {
                  const id = modelId(item);
                  return (
                    <MenuItem key={id} value={id}>
                      {modelLabel(item)}
                    </MenuItem>
                  );
                })
              ) : (
                <MenuItem value="">暂无图片模型</MenuItem>
              )}
            </Select>
          </FormControl>

          <Tooltip title="复制工作台链接">
            <span>
              <IconButton
                onClick={() => {
                  onCopy?.(new URL(playgroundURL, window.location.origin).toString());
                  onToast?.("已复制生图工作台链接");
                }}
                disabled={!playgroundURL}
              >
                <ContentCopyIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="刷新工作台">
            <IconButton onClick={refresh}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button startIcon={<OpenInNewIcon />} variant="outlined" onClick={openExternal} disabled={!playgroundURL}>
            新窗口
          </Button>
        </Stack>
      </Paper>

      {modelOptions.length ? (
        <>
          <Alert severity="info">
            这里嵌入的是完整 gpt_image_playground。顶部选择会作为初始配置传入；工作台内部修改的设置会保存在浏览器本地。
          </Alert>

          <Box
            sx={{
              border: "1px solid",
              borderColor: "app.glassBorder",
              borderRadius: 1,
              overflow: "hidden",
              bgcolor: "#050816",
              height: { xs: "calc(100vh - 220px)", md: "calc(100vh - 190px)" },
              minHeight: { xs: 620, md: 720 }
            }}
          >
            <Box
              component="iframe"
              key={playgroundURL}
              title="GPT Image Playground"
              src={playgroundURL}
              sx={{
                display: "block",
                width: "100%",
                height: "100%",
                border: 0
              }}
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          </Box>
        </>
      ) : (
        <EmptyState text="当前 API Key 没有可用于 /v1/images 的图片模型。请让管理员为此 Key 开放 gpt-image、flux、dall-e 或 nai-diffusion 模型，或切换到 NovelAI 模块使用自己的 NAI Token。" />
      )}
        </>
      ) : (
        <EmptyState text="当前账号还没有可用 API Key。请先在“我的 Key”里创建或启用一个 Key 后再使用 GPT 工坊，或切换到 NovelAI 模块使用自己的 NAI Token。" />
      )}
    </Stack>
  );
}
