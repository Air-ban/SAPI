import React from "react";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import LoginIcon from "@mui/icons-material/Login";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import SchoolIcon from "@mui/icons-material/School";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ApiIcon from "@mui/icons-material/Api";
import KeyIcon from "@mui/icons-material/Key";
import TerminalIcon from "@mui/icons-material/Terminal";
import { IntroItem } from "../components/IntroItem";
import { AnnouncementTimeline } from "../components/AnnouncementTimeline";
import { ThemeModeToggle } from "../components/ThemeModeToggle";

export function HomePage({
  health,
  user,
  admin,
  announcements,
  themeMode,
  onToggleThemeMode,
  onNavigate,
  onLogout
}) {
  const statusText =
    health === "ok" ? "服务正常" : health === "fail" ? "服务异常" : "正在检查";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Box
        component="header"
        sx={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: { xs: 2, sm: 3, lg: 5 },
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "app.overlay",
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 10
        }}
      >
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Box
            aria-hidden="true"
            sx={{
              width: 30,
              height: 30,
              borderRadius: 1,
              display: "grid",
              placeItems: "center",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              fontSize: 14,
              fontWeight: 760
            }}
          >
            S
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ lineHeight: 1, fontWeight: 650, color: "text.primary" }}>
              SAPI
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              AI SDK Gateway
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
          <ThemeModeToggle mode={themeMode} onToggle={onToggleThemeMode} />
          {user ? (
            <>
              <Button variant="contained" onClick={() => onNavigate("portal")}>
                控制台
              </Button>
              <Button color="inherit" variant="outlined" onClick={onLogout}>
                退出
              </Button>
            </>
          ) : admin ? (
            <>
              <Button variant="contained" onClick={() => onNavigate("admin")}>
                管理后台
              </Button>
              <Button color="inherit" variant="outlined" onClick={onLogout}>
                退出
              </Button>
            </>
          ) : (
            <>
              <Button startIcon={<LoginIcon />} variant="outlined" onClick={() => onNavigate("login")}>
                登录
              </Button>
              <Button startIcon={<PersonAddIcon />} variant="contained" onClick={() => onNavigate("register")}>
                注册
              </Button>
            </>
          )}
        </Stack>
      </Box>

      <Box
        sx={{
          color: "text.primary",
          py: { xs: 7, md: 10 },
          px: { xs: 2, sm: 3, lg: 5 },
          borderBottom: "1px solid",
          borderColor: "divider"
        }}
      >
        <Box
          sx={{
            maxWidth: 1180,
            mx: "auto",
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0, 0.92fr) minmax(420px, 1fr)" },
            gap: { xs: 5, md: 7 },
            alignItems: "center"
          }}
        >
          <Stack spacing={3} alignItems="flex-start">
            <Chip label={statusText} size="small" variant="outlined" />
            <Typography
              variant="h2"
              component="h1"
              sx={{ fontSize: { xs: "2.45rem", sm: "3.35rem", md: "4.35rem" }, maxWidth: 780 }}
            >
              AI SDK-ready API gateway for students.
            </Typography>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{ maxWidth: 620, fontSize: { xs: "1rem", md: "1.08rem" } }}
            >
              用一个 OpenAI 兼容端点统一接入 OpenAI、Claude、Gemini 与上游代理。
              教育邮箱注册后自助创建 API Key，直接用于 Codex、Claude Code、OpenClaw 和 Vercel AI SDK。
            </Typography>

            {!user && !admin ? (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                <Button size="large" variant="contained" startIcon={<PersonAddIcon />} onClick={() => onNavigate("register")}>
                  免费注册
                </Button>
                <Button size="large" variant="outlined" startIcon={<TerminalIcon />} onClick={() => onNavigate("login")}>
                  打开控制台
                </Button>
              </Stack>
            ) : (
              <Button size="large" variant="contained" onClick={() => onNavigate(user ? "portal" : "admin")}>
                进入控制台
              </Button>
            )}
          </Stack>

          <Paper
            variant="outlined"
            sx={{ p: 0, overflow: "hidden", borderRadius: 2, bgcolor: "app.codeBg", color: "app.codeText" }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "app.borderStrong" }}>
              <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "#ff5f57" }} />
              <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "#febc2e" }} />
              <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "#28c840" }} />
              <Typography variant="caption" sx={{ color: "app.sidebarMuted", ml: 1 }}>
                app/api/chat/route.ts
              </Typography>
            </Stack>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: { xs: 2, sm: 3 },
                overflow: "auto",
                fontFamily: '"SFMono-Regular", Consolas, Menlo, monospace',
                fontSize: { xs: 12, sm: 13 },
                lineHeight: 1.75,
                color: "app.codeText"
              }}
            >{`import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  return streamText({
    model: openai('gpt-4o-mini'),
    messages,
    baseURL: '${window.location.origin}/v1'
  }).toDataStreamResponse();
}`}</Box>
          </Paper>
        </Box>
      </Box>

      <Box component="main" sx={{ maxWidth: 1180, mx: "auto", px: { xs: 2, sm: 3 }, py: { xs: 6, md: 8 } }}>
        <Stack spacing={5}>
          <Box>
            <Typography variant="h4" sx={{ mb: 1 }}>
              面向 Agent 和 AI SDK 的统一入口
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 640 }}>
              保留 OpenAI 兼容调用体验，同时在后台集中管理模型、Key、上游健康和用量。
            </Typography>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
              gap: 1.5
            }}
          >
            <IntroItem icon={<SchoolIcon sx={{ fontSize: 28 }} />} title="学生友好" text="凭 .edu.cn 教育邮箱注册，快速获得可用 API Key。" />
            <IntroItem icon={<AutoAwesomeIcon sx={{ fontSize: 28 }} />} title="额度透明" text="控制台展示请求、Token、模型和 Key 维度用量。" />
            <IntroItem icon={<ApiIcon sx={{ fontSize: 28 }} />} title="AI SDK 适配" text="标准 OpenAI 兼容接口，能直接接入主流 Agent 和 SDK。" />
            <IntroItem icon={<KeyIcon sx={{ fontSize: 28 }} />} title="自助密钥" text="用户自助创建、轮换、禁用 API Key，管理更轻。" />
          </Box>

          {announcements.length > 0 ? <AnnouncementTimeline announcements={announcements} /> : null}

          <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, borderRadius: 2, bgcolor: "app.paperAlt" }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
              <Box>
                <Typography variant="h5" sx={{ mb: 1 }}>
                  准备好开始了吗？
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
                  已经有教育邮箱？立即注册，30 秒即可获得专属 API Key。
                </Typography>
              </Box>
              {!user && !admin ? (
                <Button variant="contained" size="large" startIcon={<RocketLaunchIcon />} onClick={() => onNavigate("register")}>
                  免费注册
                </Button>
              ) : (
                <Button variant="contained" size="large" onClick={() => onNavigate(user ? "portal" : "admin")}>
                  进入控制台
                </Button>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Box>

      <Box component="footer" sx={{ py: 4, textAlign: "center", borderTop: "1px solid", borderColor: "divider", color: "text.secondary" }}>
        <Typography variant="body2">SAPI · AI SDK-ready API gateway</Typography>
      </Box>
    </Box>
  );
}

export function RequireAccountPage({ onNavigate, themeMode, onToggleThemeMode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2, py: 4, bgcolor: "background.default" }}>
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 520, p: { xs: 2.25, sm: 3 } }}>
        <Stack spacing={2} alignItems="flex-start">
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ width: "100%" }}>
            <Chip label="需要登录" size="small" variant="outlined" />
            <ThemeModeToggle mode={themeMode} onToggle={onToggleThemeMode} />
          </Stack>
          <Typography variant="h5">请先登录或注册</Typography>
          <Typography color="text.secondary">
            模型列表、调用端点和 API Key 控制台只对已登录用户开放。
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button variant="contained" startIcon={<LoginIcon />} onClick={() => onNavigate("login")}>
              登录
            </Button>
            <Button variant="outlined" startIcon={<PersonAddIcon />} onClick={() => onNavigate("register")}>
              注册
            </Button>
            <Button color="inherit" onClick={() => onNavigate("home")}>
              返回首页
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
