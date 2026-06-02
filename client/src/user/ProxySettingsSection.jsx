import React from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ApiIcon from "@mui/icons-material/Api";
import BarChartIcon from "@mui/icons-material/BarChart";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DnsIcon from "@mui/icons-material/Dns";
import { EmptyState } from "../components/EmptyState";
import { Metric } from "../components/Metric";
import { Section } from "../components/Section";
import { formatNumber } from "../utils/helpers";

export function ProxySettingsSection({
  state,
  usage,
  providers,
  onCopy,
  onAddProvider,
  onEditProvider,
  ProviderRow
}) {
  const publicBaseUrl = state?.publicConfig?.baseUrl || window.location.origin;
  const baseUrl = `${publicBaseUrl}/v1`;
  const responseUrl = `${publicBaseUrl}/responses`;
  const anthropicUrl = `${publicBaseUrl}/v1/messages`;
  const responsesExample = [
    "curl " + responseUrl,
    '  -H "Authorization: Bearer YOUR_API_KEY"',
    '  -H "Content-Type: application/json"',
    '  -d \'{"model":"gpt-4o","input":[{"role":"user","content":"hello"}]}\''
  ].join(" \\\n");
  const claudeCodeExample = [
    "# Claude Code 配置（~/.claude/settings.json 或环境变量）",
    "export ANTHROPIC_BASE_URL=" + anthropicUrl,
    "export ANTHROPIC_API_KEY=YOUR_API_KEY",
    "",
    "# 或在 settings.json 中：",
    '# { "env": { "ANTHROPIC_BASE_URL": "' + anthropicUrl + '" } }'
  ].join("\n");

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
          gap: 2
        }}
      >
        <Metric icon={<DnsIcon />} label="对外 Base URL" value={publicBaseUrl} />
        <Metric icon={<BarChartIcon />} label="近 30 天请求" value={formatNumber(usage?.requests || 0)} />
        <Metric icon={<ApiIcon />} label="上游供应商" value={providers.length} />
      </Box>

      <Section title="对外端点" icon={<ApiIcon />}>
        <Stack spacing={1.5}>
          <TextField label="对外 `/v1` 地址" value={baseUrl} fullWidth size="small" InputProps={{ readOnly: true }} />
          <TextField label="`/responses` 地址" value={responseUrl} fullWidth size="small" InputProps={{ readOnly: true }} />
          <TextField label="Anthropic `/v1/messages` 地址" value={anthropicUrl} fullWidth size="small" InputProps={{ readOnly: true }} />
          <TextField
            label="调用示例（/responses）"
            value={responsesExample}
            fullWidth
            size="small"
            multiline
            rows={4}
            InputProps={{
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end" sx={{ alignSelf: "flex-start", mt: 0.5 }}>
                  <Tooltip title="复制示例">
                    <IconButton onClick={() => onCopy(responsesExample)} edge="end" size="small">
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              )
            }}
          />
          <TextField
            label="Claude Code 配置示例"
            value={claudeCodeExample}
            fullWidth
            size="small"
            multiline
            rows={5}
            InputProps={{
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end" sx={{ alignSelf: "flex-start", mt: 0.5 }}>
                  <Tooltip title="复制示例">
                    <IconButton onClick={() => onCopy(claudeCodeExample)} edge="end" size="small">
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              )
            }}
          />
          <Alert severity="info">
            /responses 和 /v1/messages 与普通 /v1 端点一样，使用用户的 API Key 进行认证，用量会正常统计到对应 Key 下。
          </Alert>
        </Stack>
      </Section>

      <Section
        title="上游设置"
        icon={<ApiIcon />}
        action={
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={onAddProvider}>
            新增上游
          </Button>
        }
      >
        {providers.length ? (
          <Stack spacing={1.5}>
            {providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                afterChange={onEditProvider.afterChange}
                onConfirm={onEditProvider.onConfirm}
                onToast={onEditProvider.onToast}
                onEdit={() => onEditProvider.open(provider)}
              />
            ))}
          </Stack>
        ) : (
          <EmptyState text="尚未配置上游。添加后会通过对应的 /v1 地址对外提供服务。" />
        )}
      </Section>
    </Stack>
  );
}
