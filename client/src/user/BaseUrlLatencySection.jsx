import React, { useCallback, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DnsIcon from "@mui/icons-material/Dns";
import SpeedIcon from "@mui/icons-material/Speed";
import TimelineIcon from "@mui/icons-material/Timeline";
import { Section } from "../components/Section";
import { Metric } from "../components/Metric";

const SAMPLE_COUNT = 3;
const TEST_TIMEOUT_MS = 8000;

export function BaseUrlLatencySection({ baseUrl, onCopy }) {
  const [samples, setSamples] = useState([]);
  const [testing, setTesting] = useState(false);
  const [lastError, setLastError] = useState("");

  const target = useMemo(() => normalizeHealthURL(baseUrl), [baseUrl]);
  const successSamples = samples.filter((sample) => sample.ok);
  const best = successSamples.length ? Math.min(...successSamples.map((sample) => sample.ms)) : 0;
  const avg = successSamples.length
    ? Math.round(successSamples.reduce((sum, sample) => sum + sample.ms, 0) / successSamples.length)
    : 0;
  const latest = samples[samples.length - 1];

  const runTest = useCallback(async () => {
    setTesting(true);
    setLastError("");
    setSamples([]);
    const nextSamples = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const sample = await measureLatency(target);
      nextSamples.push(sample);
      setSamples([...nextSamples]);
      if (!sample.ok) setLastError(sample.error || "请求失败");
    }
    setTesting(false);
  }, [target]);

  return (
    <Section
      title="BaseURL 时延"
      icon={<SpeedIcon />}
      action={
        <Button
          size="small"
          variant="outlined"
          startIcon={testing ? <CircularProgress size={16} /> : <TimelineIcon />}
          onClick={runTest}
          disabled={testing}
        >
          测速
        </Button>
      }
    >
      <Stack spacing={2}>
        <Paper
          variant="outlined"
          sx={{
            p: 1.25,
            display: "flex",
            alignItems: "center",
            gap: 1,
            bgcolor: "app.paperAlt",
            borderColor: "app.glassBorder",
            minWidth: 0
          }}
        >
          <DnsIcon fontSize="small" color="primary" />
          <Box
            component="code"
            sx={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
              fontSize: "0.82rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
            title={target}
          >
            {target}
          </Box>
          <Tooltip title="复制测速地址">
            <IconButton size="small" onClick={() => onCopy?.(target)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Paper>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
            gap: 1.25
          }}
        >
          <Metric icon={<SpeedIcon />} label="最佳" value={best ? `${best} ms` : "-"} />
          <Metric icon={<TimelineIcon />} label="平均" value={avg ? `${avg} ms` : "-"} />
          <Metric icon={<DnsIcon />} label="最近状态" value={latest ? (latest.ok ? `HTTP ${latest.status}` : "失败") : "-"} />
        </Box>

        {samples.length ? (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {samples.map((sample, index) => (
              <Chip
                key={`${sample.ms}-${index}`}
                size="small"
                color={sample.ok ? latencyColor(sample.ms) : "error"}
                variant={sample.ok ? "outlined" : "filled"}
                label={sample.ok ? `#${index + 1} ${sample.ms} ms` : `#${index + 1} 失败`}
              />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            点击测速后会用当前浏览器访问站点健康接口，结果更接近用户侧真实链路。
          </Typography>
        )}

        {lastError ? (
          <Typography variant="body2" color="error" sx={{ overflowWrap: "anywhere" }}>
            {lastError}
          </Typography>
        ) : null}
      </Stack>
    </Section>
  );
}

function normalizeHealthURL(baseUrl) {
  try {
    const url = new URL(baseUrl || window.location.origin, window.location.origin);
    url.pathname = "/api/health";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return `${window.location.origin}/api/health`;
  }
}

async function measureLatency(url) {
  const target = new URL(url);
  target.searchParams.set("_sapi_latency", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const started = performance.now();
  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-store",
        "Pragma": "no-cache"
      },
      signal: controller.signal
    });
    const ms = Math.max(1, Math.round(performance.now() - started));
    return { ok: response.ok, status: response.status, ms, error: response.ok ? "" : `HTTP ${response.status}` };
  } catch (err) {
    const ms = Math.max(1, Math.round(performance.now() - started));
    return { ok: false, status: 0, ms, error: err?.name === "AbortError" ? "测速超时" : (err?.message || "网络错误") };
  } finally {
    window.clearTimeout(timeout);
  }
}

function latencyColor(ms) {
  if (ms <= 300) return "success";
  if (ms <= 1000) return "warning";
  return "error";
}
