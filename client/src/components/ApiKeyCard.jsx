import React from "react";
import {
  Box,
  Chip,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Tooltip,
  Typography
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RotateRightIcon from "@mui/icons-material/RotateRight";

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

const inlineCodeSx = {
  display: "inline",
  px: 0.5,
  py: 0.15,
  mx: 0.25,
  borderRadius: 0.75,
  bgcolor: "app.codeBg",
  color: "app.codeText",
  border: "1px solid",
  borderColor: "app.borderStrong",
  fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
  fontSize: "0.92em",
  overflowWrap: "anywhere"
};

export const ApiKeyCard = React.memo(function ApiKeyCard({ apiKey, usage, onCopy, onRotate, onToggle, onDelete }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
        gap: 1.5,
        alignItems: "center",
        bgcolor: "app.paperAlt"
      }}
    >
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {apiKey.name || "API Key"}
          </Typography>
          <Chip
            size="small"
            label={apiKey.enabled ? "启用" : "停用"}
            color={apiKey.enabled ? "success" : "warning"}
            variant="outlined"
          />
          {usage ? (
            <Chip
              size="small"
              label={`请求 ${usage.requests} 次 / ${formatNumber(usage.totalTokens)} tokens`}
              variant="outlined"
            />
          ) : null}
        </Stack>
        {apiKey.allowedModels?.length > 0 ? (
          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              可用模型：
            </Typography>
            {apiKey.allowedModels.map((model) => (
              <Chip key={model} label={model} size="small" variant="outlined" color="primary" />
            ))}
          </Stack>
        ) : null}
        <Box component="code" sx={{ ...inlineCodeSx, display: "block", p: 1.1, mx: 0 }}>
          {apiKey.key || apiKey.preview || "-"}
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Typography variant="caption" color="text.secondary">
            创建：{formatDate(apiKey.createdAt)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            最近使用：{formatDate(apiKey.lastUsedAt)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            RPM 限制：{apiKey.rpmLimit > 0 ? apiKey.rpmLimit : "默认"}
          </Typography>
        </Stack>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center" justifyContent={{ xs: "flex-start", md: "flex-end" }}>
        <Tooltip title="复制 Key">
          <IconButton onClick={() => onCopy(apiKey.key)} disabled={!apiKey.key}>
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="轮换 Key">
          <IconButton onClick={onRotate}>
            <RotateRightIcon />
          </IconButton>
        </Tooltip>
        {onDelete ? (
          <Tooltip title="删除 Key">
            <IconButton color="error" onClick={onDelete}>
              <DeleteOutlineIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        <FormControlLabel
          control={<Switch checked={apiKey.enabled} onChange={onToggle} />}
          label=""
          sx={{ m: 0 }}
        />
      </Stack>
    </Paper>
  );
});
