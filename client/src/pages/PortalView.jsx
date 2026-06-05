import React, { useState } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ApiIcon from "@mui/icons-material/Api";
import BarChartIcon from "@mui/icons-material/BarChart";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DnsIcon from "@mui/icons-material/Dns";
import DownloadIcon from "@mui/icons-material/Download";
import KeyIcon from "@mui/icons-material/Key";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import RefreshIcon from "@mui/icons-material/Refresh";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { Alert } from "@mui/material";
import { ApiKeyCard } from "../components/ApiKeyCard";
import { CodeBlock } from "../components/CodeBlock";
import { DownloadConfigDialog } from "../components/DownloadConfigDialog";
import { EmptyState } from "../components/EmptyState";
import { Metric } from "../components/Metric";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { getUserApiKeys } from "../utils/helpers";
import { inlineCodeSx } from "../utils/helpers";
import { UsageSection } from "../user/UsageSection";
import { UserSettingsSection } from "../user/UserSettingsSection";
import { UserSuggestionSection } from "../user/UserSuggestionSection";
import { TokenUsageChart } from "../user/TokenUsageChart";

const CLI_TOOLS = [
  { id: "codex", name: "Codex" },
  { id: "claude-code", name: "Claude Code" },
  { id: "openclaw", name: "OpenClaw" },
  { id: "cursor", name: "Cursor" },
  { id: "aider", name: "Aider" },
  { id: "copilot", name: "GitHub Copilot" },
  { id: "cline", name: "Cline" },
  { id: "windsurf", name: "Windsurf" },
  { id: "continue", name: "Continue" }
];

export function PortalView({
  page = "overview",
  config,
  selectedKey,
  user,
  usage,
  modelAvailability,
  announcements,
  onNavigate,
  onUserLogout,
  onCreateApiKey,
  onRotateApiKey,
  onUpdateApiKey,
  onDeleteApiKey,
  onRefresh,
  onCopy,
  onUpdateSettings,
  onToast,
  ModelAvailabilityDashboard,
  onLoadRequestContent,
  AnnouncementTimeline
}) {
  const effectiveConfig = config || {
    baseUrl: window.location.origin,
    endpoints: [],
    models: []
  };
  const apiKeys = getUserApiKeys(user);
  const displayKey = selectedKey || apiKeys[0]?.key || user?.apiKey || "sk-sapi-REPLACE_WITH_YOUR_KEY";
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const firstModel = effectiveConfig.models[0];
  const model = (firstModel && typeof firstModel === "object" ? firstModel.id : firstModel) || "gpt-4o-mini";
  const curlExample = [
    `curl ${effectiveConfig.baseUrl}/v1/chat/completions \\`,
    `  -H "Authorization: Bearer ${displayKey}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"hello"}]}'`
  ].join("\n");
  const currentPage = ["overview", "key", "usage", "models", "example", "settings", "suggestion"].includes(page)
    ? page
    : "overview";
  const pageMeta = {
    overview: { title: "可调用 API", description: "API Key、模型和端点摘要。" },
    key: { title: "API Key", description: "管理你的 HanGuan's SuperAPI 调用密钥。" },
    usage: { title: "请求与用量", description: "查看 Token 用量和请求记录。" },
    models: { title: "模型与端点", description: "查看当前可用模型和 OpenAI 兼容端点。" },
    example: { title: "调用示例", description: "复制可直接执行的 curl 请求。" },
    settings: { title: "通知设置", description: "管理邮件通知偏好。" },
    suggestion: { title: "提建议", description: "提交功能建议或反馈，帮助我们做得更好。" }
  }[currentPage] || {
    title: "可调用 API",
    description: "API Key、模型和端点摘要。"
  };

  return (
    <Stack spacing={2.5}>
      <PageHeader
        eyebrow="用户前台"
        title={pageMeta.title}
        description={pageMeta.description}
        action={
          <Stack direction="row" spacing={1}>
            {!user ? (
              <>
                <Button startIcon={<LoginIcon />} variant="contained" onClick={() => onNavigate("login")}>
                  登录
                </Button>
                <Button startIcon={<PersonAddIcon />} variant="outlined" onClick={() => onNavigate("register")}>
                  注册
                </Button>
              </>
            ) : (
              <Button startIcon={<LogoutIcon />} variant="outlined" color="inherit" onClick={onUserLogout}>
                退出
              </Button>
            )}
            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={onRefresh}>
              刷新
            </Button>
          </Stack>
        }
      />

      {currentPage === "overview" ? (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1.4fr 0.8fr 0.8fr" },
          gap: 2
        }}
      >
        <Metric icon={<DnsIcon />} label="Base URL" value={effectiveConfig.baseUrl} />
        <Metric icon={<ApiIcon />} label="可用模型" value={effectiveConfig.models.length} />
        <Metric icon={<KeyIcon />} label="端点数量" value={effectiveConfig.endpoints.length} />
      </Box>
      ) : null}

      {currentPage === "overview" && AnnouncementTimeline && announcements.length > 0 ? (
        <AnnouncementTimeline announcements={announcements} />
      ) : null}

      {currentPage === "overview" && usage?.byHour?.length > 0 ? (
        <Section title="最近 24 小时 Token 用量" icon={<BarChartIcon />}>
          <TokenUsageChart data={usage.byHour} />
        </Section>
      ) : null}

      {ModelAvailabilityDashboard && ["overview", "models"].includes(currentPage) ? (
        <ModelAvailabilityDashboard availability={modelAvailability} />
      ) : null}

      {["overview", "key", "models"].includes(currentPage) ? (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns:
            currentPage === "overview" ? { xs: "1fr", lg: "minmax(0, 1fr) 390px" } : "1fr",
          gap: 2
        }}
      >
        {["overview", "key"].includes(currentPage) ? (
        <Section
          title="我的 API Key"
          icon={<KeyIcon />}
          action={
            user ? (
              <Stack direction="row" spacing={1}>
                <Button startIcon={<DownloadIcon />} variant="outlined" size="small" onClick={() => setConfigDialogOpen(true)}>
                  配置脚本
                </Button>
                <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={onCreateApiKey}>
                  新增 Key
                </Button>
              </Stack>
            ) : null
          }
        >
          {user ? (
            <Stack spacing={1.5}>
              <Alert severity={user.enabled ? "success" : "warning"} icon={<CheckCircleIcon />}>
                <Typography variant="body2" sx={{ fontWeight: 760 }}>
                  {user.name}
                </Typography>
                <Typography variant="body2">
                  状态：{user.enabled ? "已启用" : "已停用"}
                </Typography>
              </Alert>
              <Paper variant="outlined" sx={{ p: 1.25, display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                  端点 URL
                </Typography>
                <Box
                  component="code"
                  sx={{
                    flex: 1,
                    fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                    fontSize: "0.82rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                  title={effectiveConfig.baseUrl}
                >
                  {effectiveConfig.baseUrl}
                </Box>
                <Tooltip title="复制">
                  <IconButton size="small" onClick={() => onCopy(effectiveConfig.baseUrl)}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Paper>
              {apiKeys.length ? (
                <Stack spacing={1.25}>
                  {apiKeys.map((key) => (
                    <ApiKeyCard
                      key={key.id || key.key}
                      apiKey={key}
                      usage={(usage?.byApiKey || []).find((item) => item.apiKeyId === key.id)}
                      onCopy={onCopy}
                      onRotate={() => onRotateApiKey(key)}
                      onToggle={() => onUpdateApiKey?.(key.id, { enabled: !key.enabled })}
                      onDelete={() => onDeleteApiKey?.(key)}
                    />
                  ))}
                </Stack>
              ) : (
                <Alert
                  severity="info"
                  action={
                    <Button color="inherit" size="small" onClick={onCreateApiKey}>
                      创建
                    </Button>
                  }
                >
                  你还没有 API Key。创建后即可调用 HanGuan's SuperAPI 的 /v1 接口。
                </Alert>
              )}
            </Stack>
          ) : (
            <Alert
              severity="info"
              action={
                <Button color="inherit" size="small" onClick={() => onNavigate("login")}>
                  登录
                </Button>
              }
            >
              登录或注册后，可以在这里自助创建 API Key。
            </Alert>
          )}
        </Section>
        ) : null}

        {user ? (
          <DownloadConfigDialog
            open={configDialogOpen}
            onClose={() => setConfigDialogOpen(false)}
            baseUrl={effectiveConfig.baseUrl}
            apiKeys={apiKeys}
            defaultKey={displayKey}
            models={effectiveConfig.models}
            onCopy={onCopy}
          />
        ) : null}

        {["overview", "models"].includes(currentPage) ? (
        <Section title="可用模型" icon={<ApiIcon />}>
          {effectiveConfig.models.length ? (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" },
                gap: 1.5
              }}
            >
              {effectiveConfig.models.map((item) => {
                const id = item?.id || item;
                const name = item?.name || id;
                const description = item?.description || "";
                const cliSupport = item?.cliSupport || [];
                const supportedSet = new Set(cliSupport);

                return (
                  <Paper
                    key={id}
                    variant="outlined"
                    sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 0.8 }}
                  >
                    <Stack direction="row" alignItems="center" spacing={0.8}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 700,
                          fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                        title={id}
                      >
                        {name}
                      </Typography>
                    </Stack>
                    {description ? (
                      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                        {description}
                      </Typography>
                    ) : null}
                    {supportedSet.size > 0 ? (
                      <Stack direction="row" flexWrap="wrap" gap={0.4}>
                        {CLI_TOOLS.filter((cli) => supportedSet.has(cli.id)).map((cli) => (
                          <Chip
                            key={cli.id}
                            label={cli.name}
                            size="small"
                            variant="outlined"
                            color="success"
                            sx={{
                              fontSize: "0.65rem",
                              height: 20,
                              "& .MuiChip-label": { px: 0.6 }
                            }}
                          />
                        ))}
                      </Stack>
                    ) : null}
                  </Paper>
                );
              })}
            </Box>
          ) : (
            <EmptyState text="管理员还没有配置可用模型。" />
          )}
        </Section>
        ) : null}
      </Box>
      ) : null}

      {currentPage === "usage" && usage ? (
        <UsageSection usage={usage} onLoadRequestContent={onLoadRequestContent} />
      ) : null}

      {currentPage === "models" ? (
      <Section title="端点" icon={<DnsIcon />}>
        <TableContainer>
          <Table size="small" sx={{ minWidth: 620 }}>
            <TableHead>
              <TableRow>
                <TableCell>方法</TableCell>
                <TableCell>路径</TableCell>
                <TableCell>说明</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {effectiveConfig.endpoints.map((endpoint) => (
                <TableRow key={`${endpoint.method}-${endpoint.path}`} hover>
                  <TableCell sx={{ width: 110 }}>
                    <Chip
                      label={endpoint.method}
                      size="small"
                      color={endpoint.method === "GET" ? "secondary" : "primary"}
                      sx={{ fontWeight: 800, minWidth: 64 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Box component="code" sx={inlineCodeSx}>
                      {endpoint.path}
                    </Box>
                  </TableCell>
                  <TableCell>{endpoint.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>
      ) : null}

      {currentPage === "example" ? (
      <Section
        title="调用示例"
        icon={<RocketLaunchIcon />}
        action={
          <Button
            size="small"
            startIcon={<ContentCopyIcon />}
            variant="outlined"
            onClick={() => onCopy(curlExample)}
          >
            复制
          </Button>
        }
      >
        <CodeBlock value={curlExample} />
      </Section>
      ) : null}

      {currentPage === "settings" ? (
        <UserSettingsSection user={user} onUpdateSettings={onUpdateSettings} />
      ) : null}

      {currentPage === "suggestion" ? (
        <UserSuggestionSection onToast={onToast} />
      ) : null}
    </Stack>
  );
}
