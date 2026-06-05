import React from "react";
import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography
} from "@mui/material";
import ApiIcon from "@mui/icons-material/Api";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DnsIcon from "@mui/icons-material/Dns";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import TimerIcon from "@mui/icons-material/Timer";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { CLI_TOOLS } from "../constants";
import { formatDate, statusLabel } from "../utils/helpers";
import { EmptyState } from "./EmptyState";
import { Section } from "./Section";

function statusChipColor(status) {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  return "error";
}

function statusIcon(status) {
  if (status === "healthy") return <CheckCircleIcon />;
  if (status === "degraded") return <WarningAmberIcon />;
  return <ErrorOutlineIcon />;
}

function metricColor(value) {
  if (value >= 90) return "success.main";
  if (value >= 70) return "warning.main";
  return "error.main";
}

function getTtlText(availability) {
  const ttl = Number(availability?.ttlSeconds || 300);
  const minutes = Math.max(1, Math.round(ttl / 60));
  return `${minutes} 分钟 TTL`;
}

function getRemainingText(expiresAt) {
  if (!expiresAt) return "-";
  const seconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

function StatusMetric({ icon, label, value, color = "text.primary" }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        minWidth: 0,
        bgcolor: "app.paperAlt"
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          sx={{
            width: 30,
            height: 30,
            display: "grid",
            placeItems: "center",
            borderRadius: 1,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            color,
            flexShrink: 0,
            "& svg": { fontSize: 17 }
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 560 }}>
            {label}
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 780, color }} noWrap title={String(value)}>
            {value}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

export function ModelAvailabilityDashboard({ availability }) {
  const models = Array.isArray(availability?.models) ? availability.models : [];
  if (!models.length) {
    return (
      <Section
        title="模型可用性"
        icon={<ApiIcon />}
        action={<Chip label={getTtlText(availability)} size="small" variant="outlined" />}
      >
        <EmptyState text="暂无模型可用性数据。" />
      </Section>
    );
  }

  const healthy = models.filter((model) => model.healthStatus === "healthy").length;
  const degraded = models.filter((model) => model.healthStatus === "degraded").length;
  const unavailable = models.length - healthy - degraded;
  const available = healthy + degraded;
  const remaining = getRemainingText(availability?.expiresAt);

  return (
    <Section
      title="模型可用性"
      icon={<ApiIcon />}
      action={
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Chip label={getTtlText(availability)} size="small" variant="outlined" />
          <Chip label={`剩余 ${remaining}`} size="small" color="primary" variant="outlined" />
        </Stack>
      }
    >
      <Stack spacing={1.5}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
            gap: 1.25
          }}
        >
          <StatusMetric icon={<CheckCircleIcon />} label="可路由模型" value={`${available}/${models.length}`} color="success.main" />
          <StatusMetric icon={<WarningAmberIcon />} label="降级模型" value={degraded} color={degraded > 0 ? "warning.main" : "text.secondary"}/>
          <StatusMetric icon={<ErrorOutlineIcon />} label="不可用模型" value={unavailable} color={unavailable > 0 ? "error.main" : "text.secondary"}/>
          <StatusMetric icon={<TimerIcon />} label="缓存更新" value={formatDate(availability?.cachedAt)} color="primary.main" />
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
            gap: 1.25
          }}
        >
          {models.map((model) => {
            const availability7d = Number(model.availability7d ?? 100);
            const providerTotal = Number(model.providers || 0);
            const providerAvailable = Number(model.availableProviders || 0);
            const supportedSet = new Set(Array.isArray(model.cliSupport) ? model.cliSupport : []);
            const history = Array.isArray(model.healthHistory) ? model.healthHistory.slice(-24) : [];

            return (
              <Paper
                key={model.id}
                variant="outlined"
                sx={{
                  p: 1.5,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.1,
                  bgcolor: "background.paper"
                }}
              >
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                  <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 780,
                        fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                      title={model.id}
                    >
                      {model.name || model.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {providerAvailable}/{providerTotal} 个上游可路由
                    </Typography>
                  </Stack>
                  <Chip
                    icon={statusIcon(model.healthStatus)}
                    label={statusLabel(model.healthStatus)}
                    size="small"
                    color={statusChipColor(model.healthStatus)}
                    variant="outlined"
                    sx={{
                      flexShrink: 0,
                      fontWeight: 720,
                      "& .MuiChip-icon": { fontSize: 15 }
                    }}
                  />
                </Stack>

                {model.description ? (
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>
                    {model.description}
                  </Typography>
                ) : null}

                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 0.8 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      延迟
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 780 }}>
                      {model.latency || 0}
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.25 }}>
                        ms
                      </Typography>
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      PING
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 780 }}>
                      {model.ping || 0}
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.25 }}>
                        ms
                      </Typography>
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      7 天
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 780, color: metricColor(availability7d) }}>
                      {availability7d.toFixed(1)}%
                    </Typography>
                  </Box>
                </Box>

                <LinearProgress
                  variant="determinate"
                  value={providerTotal ? Math.round((providerAvailable / providerTotal) * 100) : 0}
                  color={model.healthStatus === "healthy" ? "success" : model.healthStatus === "degraded" ? "warning" : "error"}
                  sx={{
                    height: 6,
                    borderRadius: 1,
                    bgcolor: "app.paperAlt"
                  }}
                />

                {supportedSet.size > 0 ? (
                  <Stack direction="row" flexWrap="wrap" gap={0.4}>
                    {CLI_TOOLS.filter((cli) => supportedSet.has(cli.id)).map((cli) => (
                      <Chip
                        key={cli.id}
                        label={cli.name}
                        size="small"
                        variant="outlined"
                        color="success"
                        sx={{ height: 20, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.6 } }}
                      />
                    ))}
                  </Stack>
                ) : null}

                {history.length > 0 ? (
                  <Stack direction="row" alignItems="flex-end" spacing={0.35} sx={{ height: 22 }}>
                    {history.map((entry, index) => {
                      const color =
                        entry.status === "ok"
                          ? "success.main"
                          : entry.status === "slow"
                            ? "warning.main"
                            : "error.main";
                      const heightPct = Math.min(100, Math.max(18, (Number(entry.latency || 0) / 5000) * 100));
                      return (
                        <Tooltip
                          key={`${entry.timestamp}-${index}`}
                          title={`${new Date(entry.timestamp).toLocaleTimeString("zh-CN")} · ${entry.latency}ms · ${entry.status}`}
                          arrow
                        >
                          <Box
                            sx={{
                              flex: 1,
                              minWidth: 2,
                              maxWidth: 5,
                              height: `${heightPct}%`,
                              bgcolor: color,
                              borderRadius: 0.4,
                              opacity: 0.85
                            }}
                          />
                        </Tooltip>
                      );
                    })}
                  </Stack>
                ) : null}

                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {model.availableProviderNames?.length ? model.availableProviderNames.join(", ") : "暂无可路由上游"}
                  </Typography>
                  <DnsIcon sx={{ color: "text.disabled", fontSize: 15, flexShrink: 0 }} />
                </Stack>
              </Paper>
            );
          })}
        </Box>
      </Stack>
    </Section>
  );
}
