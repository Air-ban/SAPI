import React from "react";
import {
  Box,
  Chip,
  Paper,
  Stack,
  Tooltip,
  Typography
} from "@mui/material";
import ApiIcon from "@mui/icons-material/Api";
import { CLI_TOOLS } from "../constants";
import { Section } from "../components/Section";
import { normalizeModelFrontend, statusLabel } from "../utils/helpers";

export function ModelHealthSection({ providers }) {
  if (!providers || providers.length === 0) return null;

  const modelMap = new Map();
  for (const provider of providers) {
    const models = (provider.models || []).map(normalizeModelFrontend);
    for (const model of models) {
      if (!model.id) continue;
      if (modelMap.has(model.id)) {
        const existing = modelMap.get(model.id);
        if (!existing.description && model.description) existing.description = model.description;
        if (model.cliSupport.length > existing.cliSupport.length) existing.cliSupport = model.cliSupport;
        continue;
      }
      modelMap.set(model.id, {
        id: model.id,
        name: model.name || model.id,
        description: model.description || "",
        cliSupport: model.cliSupport || [],
        healthStatus: provider.healthStatus,
        latency: provider.latency || 0,
        ping: provider.ping || 0,
        availability7d: provider.availability7d ?? 100,
        healthHistory: provider.healthHistory || []
      });
    }
    for (const [customId] of Object.entries(provider.modelMappings || {})) {
      if (customId && !modelMap.has(customId)) {
        modelMap.set(customId, {
          id: customId,
          name: customId,
          description: "",
          cliSupport: [],
          healthStatus: provider.healthStatus,
          latency: provider.latency || 0,
          ping: provider.ping || 0,
          availability7d: provider.availability7d ?? 100,
          healthHistory: provider.healthHistory || []
        });
      }
    }
  }

  const modelEntries = Array.from(modelMap.values());
  if (modelEntries.length === 0) return null;

  return (
    <Section title="模型状态" icon={<ApiIcon />}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" },
          gap: 1.5
        }}
      >
        {modelEntries.map((entry) => {
          const label = statusLabel(entry.healthStatus);
          const statusChipColor =
            entry.healthStatus === "healthy"
              ? "success"
              : entry.healthStatus === "degraded"
                ? "warning"
                : "error";
          const availability = entry.availability7d;
          const availabilityColor =
            availability >= 90 ? "success.main" : availability >= 70 ? "warning.main" : "error.main";
          const history = entry.healthHistory.slice(-30);
          const supportedSet = new Set(entry.cliSupport);

          return (
            <Paper
              key={entry.id}
              variant="outlined"
              sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.5}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 760,
                    fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0
                  }}
                  title={entry.id}
                >
                  {entry.name}
                </Typography>
                <Chip label={label} size="small" color={statusChipColor} variant="outlined" sx={{ fontWeight: 700, flexShrink: 0, fontSize: "0.7rem", height: 20 }} />
              </Stack>

              {entry.description ? (
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                  {entry.description}
                </Typography>
              ) : null}

              {CLI_TOOLS.length > 0 && entry.cliSupport.length > 0 ? (
                <Stack direction="row" flexWrap="wrap" gap={0.3}>
                  {CLI_TOOLS.filter((cli) => supportedSet.has(cli.id)).map((cli) => (
                    <Chip
                      key={cli.id}
                      label={cli.name}
                      size="small"
                      color="success"
                      variant="outlined"
                      sx={{ fontSize: "0.6rem", height: 18, "& .MuiChip-label": { px: 0.5 } }}
                    />
                  ))}
                </Stack>
              ) : null}

              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0.8 }}>
                <Box sx={{ textAlign: "center" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.65rem" }}>
                    延迟
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, fontSize: "0.85rem" }}>
                    {entry.latency}<Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: "0.6rem" }}>ms</Typography>
                  </Typography>
                </Box>
                <Box sx={{ textAlign: "center" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.65rem" }}>
                    PING
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, fontSize: "0.85rem" }}>
                    {entry.ping}<Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: "0.6rem" }}>ms</Typography>
                  </Typography>
                </Box>
                <Box sx={{ textAlign: "center" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.65rem" }}>
                    可用性
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, fontSize: "0.85rem", color: availabilityColor }}>
                    {availability.toFixed(1)}%
                  </Typography>
                </Box>
              </Box>

              {history.length > 0 ? (
                <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.3, height: 20 }}>
                  {history.map((entry, index) => {
                    const hColor =
                      entry.status === "ok"
                        ? "success.main"
                        : entry.status === "slow"
                          ? "warning.main"
                          : "error.main";
                    const heightPct = Math.min(100, Math.max(15, (entry.latency / 5000) * 100));
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
                            maxWidth: 4,
                            height: `${heightPct}%`,
                            bgcolor: hColor,
                            borderRadius: 0.3,
                            opacity: 0.85,
                            transition: "opacity 0.2s",
                            "&:hover": { opacity: 1 }
                          }}
                        />
                      </Tooltip>
                    );
                  })}
                </Box>
              ) : null}
            </Paper>
          );
        })}
      </Box>
    </Section>
  );
}
