import React, { useState } from "react";
import {
  Box,
  Chip,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
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

function formatRpmLimit(value) {
  return Number(value || 0) > 0 ? `${Number(value).toLocaleString()} RPM` : "不限 RPM";
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

export const ApiKeyCard = React.memo(function ApiKeyCard({ apiKey, usage, onCopy, onRotate, onToggle, onDelete, onRename }) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(apiKey.name || "API Key");
  const [savingName, setSavingName] = useState(false);

  const startRename = () => {
    setDraftName(apiKey.name || "API Key");
    setRenaming(true);
  };

  const cancelRename = () => {
    setDraftName(apiKey.name || "API Key");
    setRenaming(false);
  };

  const submitRename = async () => {
    const nextName = draftName.trim();
    if (!nextName || !onRename || savingName) return;
    if (nextName === (apiKey.name || "API Key")) {
      setRenaming(false);
      return;
    }
    setSavingName(true);
    try {
      await onRename(nextName);
      setRenaming(false);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
        gap: 1.5,
        alignItems: "center",
        position: "relative",
        overflow: "hidden",
        background: (theme) => theme.palette.app.glass,
        borderColor: "app.glassBorder",
        boxShadow: (theme) => theme.palette.app.softShadow,
        transition:
          "transform 0.2s cubic-bezier(.2,.8,.2,1), border-color 0.2s ease, box-shadow 0.2s ease",
        "&::before": {
          content: '""',
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: 3,
          bgcolor: apiKey.enabled ? "app.accentGreen" : "app.accentAmber",
          opacity: 0.8
        },
        "&:hover": {
          transform: "translateY(-1px)",
          borderColor: "app.borderStrong",
          boxShadow: (theme) => theme.palette.app.shadow
        },
        "@media (prefers-reduced-motion: reduce)": {
          "&:hover": {
            transform: "none"
          }
        }
      }}
    >
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          {renaming ? (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: { xs: "100%", sm: 260 } }}>
              <TextField
                size="small"
                value={draftName}
                disabled={savingName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
                inputProps={{ maxLength: 64 }}
                sx={{ flex: 1 }}
              />
              <Tooltip title="保存名称">
                <IconButton size="small" onClick={submitRename} disabled={savingName || !draftName.trim()}>
                  <CheckIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="取消">
                <IconButton size="small" onClick={cancelRename} disabled={savingName}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ) : (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }} noWrap title={apiKey.name || "API Key"}>
                {apiKey.name || "API Key"}
              </Typography>
              {onRename ? (
                <Tooltip title="重命名">
                  <IconButton size="small" onClick={startRename}>
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Stack>
          )}
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
            有效 RPM：{formatRpmLimit(apiKey.effectiveRpmLimit)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            单 Key：{apiKey.rpmLimit > 0 ? formatRpmLimit(apiKey.rpmLimit) : "跟随订阅"}
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
          control={<Switch checked={apiKey.enabled} onChange={onToggle} disabled={!onToggle} />}
          label=""
          sx={{ m: 0 }}
        />
      </Stack>
    </Paper>
  );
});
