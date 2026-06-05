import React from "react";
import {
  Box,
  Chip,
  Paper,
  Stack,
  Tooltip,
  Typography
} from "@mui/material";
import { inferVendor, statusLabel } from "../utils/helpers";

export function ProviderHealthCard({ provider }) {
  const vendor = inferVendor(provider.name, provider.baseUrl);
  const primaryModel = provider.models?.[0];
  const modelName = primaryModel?.name || primaryModel?.id || "";
  const history = (provider.healthHistory || []).slice(-60);
  const availability = provider.availability7d ?? 100;
  const label = statusLabel(provider.healthStatus);
  const statusChipColor =
    provider.healthStatus === "healthy"
      ? "success"
      : provider.healthStatus === "degraded"
        ? "warning"
        : "error";
  const availabilityColor =
    availability >= 90 ? "success.main" : availability >= 70 ? "warning.main" : "error.main";

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        bgcolor: "background.paper"
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 780, overflowWrap: "anywhere" }}>
            {provider.name}
          </Typography>
          {vendor ? (
            <Chip label={vendor} size="small" color="primary" variant="outlined" sx={{ fontSize: 11, height: 22, flexShrink: 0 }} />
          ) : null}
        </Stack>
        <Chip label={label} size="small" color={statusChipColor} variant="outlined" sx={{ fontWeight: 700, flexShrink: 0 }} />
      </Stack>

      {provider.isAvailableForFailover === false ? (
        <Chip label="已排除" size="small" color="error" sx={{ fontWeight: 700, alignSelf: "flex-start" }} />
      ) : (provider.consecutiveFailures || 0) > 0 ? (
        <Chip label="备用中" size="small" color="warning" variant="outlined" sx={{ fontWeight: 700, alignSelf: "flex-start" }} />
      ) : null}

      {modelName ? (
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            fontFamily: 'Consolas, monospace',
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
          title={modelName}
        >
          {modelName}
        </Typography>
      ) : null}

      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
        <Paper variant="outlined" sx={{ p: 1.25, bgcolor: "app.successSoft" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
            对话延迟
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
            {provider.latency || 0}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.3 }}>
              ms
            </Typography>
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.25, bgcolor: "app.primarySoft" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
            端点 PING
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
            {provider.ping || 0}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.3 }}>
              ms
            </Typography>
          </Typography>
        </Paper>
      </Box>

      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">
          可用性 · 7 天
        </Typography>
        <Stack direction="row" alignItems="baseline" spacing={0.3}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: availabilityColor }}>
            {availability.toFixed(2)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: availabilityColor }}>
            %
          </Typography>
        </Stack>
      </Stack>

      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">
          故障转移
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: provider.isAvailableForFailover === false ? "error.main" : (provider.consecutiveFailures || 0) > 0 ? "warning.main" : "success.main" }}>
          {provider.isAvailableForFailover === false
            ? `已排除 (${provider.consecutiveFailures}/${provider.failoverThreshold ?? 3})`
            : (provider.consecutiveFailures || 0) > 0
              ? `备用中 (${provider.consecutiveFailures}/${provider.failoverThreshold ?? 3})`
              : "正常"}
        </Typography>
      </Stack>

      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            近 {history.length} 次记录
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {provider.lastHealthCheck
              ? `${Math.max(0, Math.round((Date.now() - new Date(provider.lastHealthCheck).getTime()) / 1000))}s 后刷新`
              : ""}
          </Typography>
        </Stack>
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.4, height: 32 }}>
          {history.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              暂无记录
            </Typography>
          ) : (
            history.map((entry, index) => {
              const hColor =
                entry.status === "ok"
                  ? "success.main"
                  : entry.status === "slow"
                    ? "warning.main"
                    : "error.main";
              const heightPct = Math.min(100, Math.max(12, (entry.latency / 5000) * 100));
              return (
                <Tooltip
                  key={index}
                  title={`${new Date(entry.timestamp).toLocaleTimeString("zh-CN")} · ${entry.latency}ms · ${entry.status}`}
                  arrow
                >
                  <Box
                    sx={{
                      flex: 1,
                      minWidth: 2,
                      maxWidth: 5,
                      height: `${heightPct}%`,
                      bgcolor: hColor,
                      borderRadius: 0.4,
                      opacity: 0.85,
                      transition: "opacity 0.2s",
                      "&:hover": { opacity: 1 }
                    }}
                  />
                </Tooltip>
              );
            })
          )}
        </Box>
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.25 }}>
          <Typography variant="caption" sx={{ color: "text.disabled", fontSize: 10 }}>
            PAST
          </Typography>
          <Typography variant="caption" sx={{ color: "text.disabled", fontSize: 10 }}>
            NOW
          </Typography>
        </Stack>
      </Box>
    </Paper>
  );
}
