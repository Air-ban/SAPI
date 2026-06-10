import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography
} from "@mui/material";
import ComputerIcon from "@mui/icons-material/Computer";
import DnsIcon from "@mui/icons-material/Dns";
import MemoryIcon from "@mui/icons-material/Memory";
import RefreshIcon from "@mui/icons-material/Refresh";
import SpeedIcon from "@mui/icons-material/Speed";
import StorageIcon from "@mui/icons-material/Storage";
import { Section } from "../components/Section";
import { Metric } from "../components/Metric";
import { request } from "../utils/api";
import { formatDate, formatNumber } from "../utils/helpers";

const REFRESH_OPTIONS = [
  { value: 0, label: "手动刷新" },
  { value: 5, label: "5 秒" },
  { value: 15, label: "15 秒" },
  { value: 30, label: "30 秒" },
  { value: 60, label: "60 秒" }
];

const MODULE_LABELS = {
  OS: "系统",
  Host: "主机",
  Kernel: "内核",
  Uptime: "运行时长",
  Packages: "软件包",
  Shell: "Shell",
  Display: "显示",
  DE: "桌面环境",
  WM: "窗口管理",
  Terminal: "终端",
  CPU: "CPU",
  GPU: "GPU",
  Memory: "内存",
  Swap: "Swap",
  Disk: "磁盘",
  LocalIP: "本地 IP",
  PublicIP: "公网 IP",
  Battery: "电池",
  PowerAdapter: "电源",
  Locale: "语言区域"
};

export function ServerStatusSection({ onToast }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(15);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request("/api/admin/server-status");
      setStatus(data);
    } catch (err) {
      setError(err.message || "服务器状态读取失败");
      onToast?.(err.message || "服务器状态读取失败", "error");
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!intervalSeconds) return undefined;
    const timer = window.setInterval(loadStatus, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [intervalSeconds, loadStatus]);

  const modules = useMemo(() => normalizeFastfetchModules(status?.fastfetch?.modules), [status]);
  const summary = useMemo(() => buildSummary(status, modules), [status, modules]);

  return (
    <Stack spacing={2.5}>
      <Section
        title="服务器中控"
        icon={<ComputerIcon />}
        action={
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
            <FormControl size="small" sx={{ minWidth: 132 }}>
              <InputLabel id="server-refresh-interval">刷新频率</InputLabel>
              <Select
                labelId="server-refresh-interval"
                label="刷新频率"
                value={intervalSeconds}
                onChange={(event) => setIntervalSeconds(Number(event.target.value))}
              >
                {REFRESH_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              size="small"
              variant="outlined"
              startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
              onClick={loadStatus}
              disabled={loading}
            >
              刷新
            </Button>
          </Stack>
        }
      >
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {status?.fastfetch && !status.fastfetch.available ? (
            <Alert severity="warning">
              fastfetch 暂不可用，当前展示 Go 运行时和存储健康数据。
            </Alert>
          ) : null}

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
              gap: 2
            }}
          >
            <Metric icon={<ComputerIcon />} label="主机" value={summary.host || "-"} />
            <Metric icon={<MemoryIcon />} label="内存" value={summary.memory || "-"} />
            <Metric icon={<StorageIcon />} label="磁盘" value={summary.disk || "-"} />
            <Metric icon={<SpeedIcon />} label="Goroutines" value={formatNumber(status?.goroutines)} />
          </Box>

          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "app.paperAlt", borderColor: "app.glassBorder" }}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1.5}
              alignItems={{ xs: "stretch", md: "center" }}
              justifyContent="space-between"
            >
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" icon={<DnsIcon />} label={`Go ${status?.goVersion || "-"}`} />
                <Chip size="small" label={`检查 ${formatDate(status?.checkedAt)}`} variant="outlined" />
                <Chip
                  size="small"
                  color={status?.store?.postgres?.ok === false ? "warning" : "success"}
                  label={`PostgreSQL ${status?.store?.postgres?.ok === false ? "异常" : "正常"}`}
                  variant="outlined"
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {intervalSeconds ? `${intervalSeconds} 秒自动刷新` : "手动刷新"}
              </Typography>
            </Stack>
          </Paper>

          {modules.length ? (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
                gap: 1.25
              }}
            >
              {modules.map((module) => (
                <FastfetchModuleCard key={`${module.type}-${module.title}`} module={module} />
              ))}
            </Box>
          ) : null}
        </Stack>
      </Section>
    </Stack>
  );
}

function FastfetchModuleCard({ module }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        minHeight: 96,
        borderColor: "app.glassBorder",
        background: (theme) => theme.palette.app.glass,
        transition: "transform 0.22s cubic-bezier(.2,.8,.2,1), border-color 0.2s ease",
        "&:hover": {
          transform: "translateY(-1px)",
          borderColor: "app.borderStrong"
        },
        "@media (prefers-reduced-motion: reduce)": {
          "&:hover": { transform: "none" }
        }
      }}
    >
      <Stack spacing={0.8}>
        <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" sx={{ fontWeight: 780 }} noWrap title={module.title}>
            {module.title}
          </Typography>
          <Chip size="small" label={module.type} variant="outlined" sx={{ height: 22 }} />
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.55 }}
        >
          {module.value || "-"}
        </Typography>
      </Stack>
    </Paper>
  );
}

function normalizeFastfetchModules(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const type = String(entry?.type || entry?.module || entry?.name || "Module");
      return {
        type,
        title: MODULE_LABELS[type] || type,
        value: stringifyFastfetchResult(entry?.result ?? entry?.value ?? entry)
      };
    })
    .filter((entry) => entry.value && entry.type !== "Break" && entry.type !== "Separator");
}

function stringifyFastfetchResult(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyFastfetchResult).filter(Boolean).join("\n");
  }
  const preferred = [
    value.prettyName,
    value.name,
    value.version,
    value.vendor,
    value.model,
    value.cpu,
    value.gpu,
    value.host,
    value.kernel,
    value.shell,
    value.ip,
    value.ipv4,
    value.ipv6
  ].filter(Boolean);
  if (preferred.length) return preferred.join(" · ");

  const pairs = Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined && item !== "")
    .slice(0, 8)
    .map(([key, item]) => `${key}: ${stringifyFastfetchResult(item)}`);
  return pairs.join("\n");
}

function buildSummary(status, modules) {
  const find = (type) => modules.find((module) => module.type === type)?.value || "";
  const memory = find("Memory") || bytesSummary(status?.memory?.heapAllocBytes, status?.memory?.sysBytes);
  return {
    host: find("Host") || find("OS"),
    memory,
    disk: find("Disk") || bytesSummary(status?.memory?.allocBytes, status?.memory?.sysBytes)
  };
}

function bytesSummary(used, total) {
  const usedText = formatBytes(used);
  const totalText = formatBytes(total);
  if (usedText === "-" && totalText === "-") return "-";
  if (usedText !== "-" && totalText !== "-") return `${usedText} / ${totalText}`;
  return usedText !== "-" ? usedText : totalText;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = bytes;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current >= 10 ? current.toFixed(0) : current.toFixed(1)} ${units[index]}`;
}
