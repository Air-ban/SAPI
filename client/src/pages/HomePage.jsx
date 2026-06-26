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
          borderColor: "app.sidebarBorder",
          bgcolor: "background.default",
          position: "sticky",
          top: 0,
          zIndex: 10
        }}
      >
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Box
            aria-hidden="true"
            sx={{
              width: 28,
              height: 28,
              borderRadius: "6px",
              display: "grid",
              placeItems: "center",
              bgcolor: "text.primary",
              color: "background.default",
              fontSize: 13,
              fontWeight: 700
            }}
          >
            S
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ lineHeight: 1, fontWeight: 600, color: "text.primary" }}>
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
          borderColor: "app.sidebarBorder"
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
            <Chip
              label={statusText}
              size="small"
              variant="outlined"
              sx={{
                borderRadius: "9999px",
                px: 0.5,
                bgcolor: health === "ok" ? "app.successSoft" : "app.errorSoft",
                color: health === "ok" ? "success.main" : "error.main",
                borderColor: "transparent",
                fontWeight: 600
              }}
            />
            <Typography
              variant="h2"
              component="h1"
              sx={{
                fontSize: { xs: "2.45rem", sm: "3.35rem", md: "4.35rem" },
                maxWidth: 780,
                fontWeight: 600,
                letterSpacing: "-2.4px",
                lineHeight: 1.05
              }}
            >
              AI SDK-ready API gateway for students.
            </Typography>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{ maxWidth: 620, fontSize: { xs: "1rem", md: "1.08rem" }, lineHeight: 1.6 }}
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
            sx={{
              p: 0,
              overflow: "hidden",
              borderRadius: "8px",
              bgcolor: "app.codeBg",
              color: "app.codeText",
              borderColor: "app.sidebarBorder",
              boxShadow: "rgba(0, 0, 0, 0.16) 0px 4px 16px"
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "rgba(255,255,255,0.1)" }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#ff5f57" }} />
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#febc2e" }} />
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#28c840" }} />
              <Typography variant="caption" sx={{ color: "text.secondary", ml: 1, fontFamily: "Geist Mono, monospace", fontSize: "0.75rem" }}>
                app/api/chat/route.ts
              </Typography>
            </Stack>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: { xs: 2, sm: 3 },
                overflow: "auto",
                fontFamily: 'Geist Mono, "SFMono-Regular", Consolas, Menlo, monospace',
                fontSize: { xs: 12, sm: 13 },
                lineHeight: 1.7,
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
            <Typography variant="h4" sx={{ mb: 1, fontWeight: 600, letterSpacing: "-1.28px" }}>
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
              gap: 2
            }}
          >
            <IntroItem icon={<SchoolIcon sx={{ fontSize: 24, color: "text.primary" }} />} title="学生友好" text="凭 .edu.cn 教育邮箱注册，快速获得可用 API Key。" />
            <IntroItem icon={<AutoAwesomeIcon sx={{ fontSize: 24, color: "text.primary" }} />} title="额度透明" text="控制台展示请求、Token、模型和 Key 维度用量。" />
            <IntroItem icon={<ApiIcon sx={{ fontSize: 24, color: "text.primary" }} />} title="AI SDK 适配" text="标准 OpenAI 兼容接口，能直接接入主流 Agent 和 SDK。" />
            <IntroItem icon={<KeyIcon sx={{ fontSize: 24, color: "text.primary" }} />} title="自助密钥" text="用户自助创建、轮换、禁用 API Key，管理更轻。" />
          </Box>

          {announcements.length > 0 ? <AnnouncementTimeline announcements={announcements} /> : null}

          <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, borderRadius: "8px", bgcolor: "app.paperAlt", borderColor: "app.sidebarBorder" }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
              <Box>
                <Typography variant="h5" sx={{ mb: 1, fontWeight: 600, letterSpacing: "-0.96px" }}>
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

      <Box component="footer" sx={{ py: 4, textAlign: "center", borderTop: "1px solid", borderColor: "app.sidebarBorder", color: "text.secondary" }}>
        <Typography variant="body2" sx={{ fontSize: "0.85rem" }}>SAPI · AI SDK-ready API gateway</Typography>
      </Box>
    </Box>
  );
}

export function RequireAccountPage({ onNavigate, themeMode, onToggleThemeMode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2, py: 4, bgcolor: "background.default" }}>
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 520, p: { xs: 2.25, sm: 3 }, borderRadius: "8px", borderColor: "app.sidebarBorder" }}>
        <Stack spacing={2} alignItems="flex-start">
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ width: "100%" }}>
            <Chip
              label="需要登录"
              size="small"
              variant="outlined"
              sx={{
                borderRadius: "9999px",
                bgcolor: "app.errorSoft",
                color: "error.main",
                borderColor: "transparent",
                fontWeight: 600
              }}
            />
            <ThemeModeToggle mode={themeMode} onToggle={onToggleThemeMode} />
          </Stack>
          <Typography variant="h5" sx={{ fontWeight: 600, letterSpacing: "-0.96px" }}>请先登录或注册</Typography>
          <Typography color="text.secondary" sx={{ fontSize: "0.92rem", lineHeight: 1.5 }}>
            模型列表、调用端点和 API Key 控制台只对已登录用户开放。
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: "100%" }}>
            <Button variant="contained" startIcon={<LoginIcon />} onClick={() => onNavigate("login")} sx={{ flex: { xs: 1, sm: "none" } }}>
              登录
            </Button>
            <Button variant="outlined" startIcon={<PersonAddIcon />} onClick={() => onNavigate("register")} sx={{ flex: { xs: 1, sm: "none" } }}>
              注册
            </Button>
            <Button color="inherit" onClick={() => onNavigate("home")} sx={{ flex: { xs: 1, sm: "none" } }}>
              返回首页
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
