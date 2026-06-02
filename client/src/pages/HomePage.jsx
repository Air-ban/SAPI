import React from "react";
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography
} from "@mui/material";
import LoginIcon from "@mui/icons-material/Login";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import SchoolIcon from "@mui/icons-material/School";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ApiIcon from "@mui/icons-material/Api";
import KeyIcon from "@mui/icons-material/Key";
import { IntroItem } from "../components/IntroItem";
import { AnnouncementTimeline } from "../components/AnnouncementTimeline";

export function HomePage({ health, user, admin, announcements, onNavigate, onLogout }) {
  const statusText =
    health === "ok" ? "服务正常" : health === "fail" ? "服务异常" : "正在检查";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Box
        component="header"
        sx={{
          height: 68,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: { xs: 2, sm: 3, lg: 5 },
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper"
        }}
      >
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Box
            component="img"
            src="https://hanguasapi.oss-cn-beijing.aliyuncs.com/%E5%9B%BE%E7%89%87-removebg-preview.png"
            alt="HanGuan's SuperAPI"
            sx={{
              width: 38,
              height: 38,
              borderRadius: 1,
              objectFit: "contain"
            }}
          />
          <Box>
            <Typography variant="h6" sx={{ lineHeight: 1 }}>
              HanGuan's SuperAPI
            </Typography>
            <Typography variant="caption" color="text.secondary">
              LLM API Relay
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1}>
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
          background: "linear-gradient(155deg, #0d7377 0%, #0a5c5f 30%, #14a3a8 70%, #0d9488 100%)",
          color: "#fff",
          py: { xs: 8, md: 12 },
          px: { xs: 2, sm: 3, lg: 5 },
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
          "&::before": {
            content: '""',
            position: "absolute",
            top: -100,
            right: -100,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)"
          },
          "&::after": {
            content: '""',
            position: "absolute",
            bottom: -80,
            left: -80,
            width: 300,
            height: 300,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%)"
          }
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1, maxWidth: 900, mx: "auto" }}>
          <Chip
            label={statusText}
            sx={{
              mb: 3,
              bgcolor: "rgba(255,255,255,0.15)",
              color: "#fff",
              borderColor: "rgba(255,255,255,0.3)",
              fontWeight: 760,
              backdropFilter: "blur(4px)"
            }}
            variant="outlined"
          />
          <Typography
            variant="h2"
            component="h1"
            sx={{
              fontWeight: 900,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              mb: 2,
              fontSize: { xs: "2.2rem", sm: "3rem", md: "3.6rem" }
            }}
          >
            大学生免费 AI API 中转站
          </Typography>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 400,
              opacity: 0.92,
              lineHeight: 1.6,
              mb: 1,
              maxWidth: 720,
              mx: "auto",
              fontSize: { xs: "1.1rem", md: "1.4rem" }
            }}
          >
            对在校大学生完全免费开放，Token 用量无限制
          </Typography>
          <Typography
            variant="body1"
            sx={{
              opacity: 0.75,
              maxWidth: 640,
              mx: "auto",
              mb: 4,
              lineHeight: 1.7
            }}
          >
            使用 .edu.cn 教育邮箱注册，即刻获得无限 Token 额度，
            完美适配 Codex、Claude Code、OpenClaw 等多种 Agent 工具。
          </Typography>

          {!user && !admin ? (
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              justifyContent="center"
              alignItems="center"
            >
              <Button
                size="large"
                variant="contained"
                startIcon={<PersonAddIcon />}
                onClick={() => onNavigate("register")}
                sx={{
                  bgcolor: "#fff",
                  color: "#0d7377",
                  fontWeight: 780,
                  px: 4,
                  py: 1.2,
                  fontSize: "1.05rem",
                  borderRadius: 2.5,
                  boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
                  "&:hover": { bgcolor: "#f0fdfa", boxShadow: "0 6px 20px rgba(0,0,0,0.2)", transform: "translateY(-1px)" }
                }}
              >
                教育邮箱注册
              </Button>
              <Button
                size="large"
                variant="outlined"
                startIcon={<LoginIcon />}
                onClick={() => onNavigate("login")}
                sx={{
                  color: "#fff",
                  borderColor: "rgba(255,255,255,0.5)",
                  fontWeight: 720,
                  px: 4,
                  py: 1.2,
                  fontSize: "1.05rem",
                  "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,0.08)" }
                }}
              >
                登录使用
              </Button>
            </Stack>
          ) : (
            <Button
              size="large"
              variant="contained"
              onClick={() => onNavigate(user ? "portal" : "admin")}
              sx={{
                bgcolor: "#fff",
                color: "#0f766e",
                fontWeight: 780,
                px: 4,
                py: 1.2,
                fontSize: "1.05rem",
                "&:hover": { bgcolor: "#f0fdfa" }
              }}
            >
              进入控制台
            </Button>
          )}
        </Box>
      </Box>

      <Box
        component="main"
        sx={{
          maxWidth: 1100,
          mx: "auto",
          px: { xs: 2, sm: 3 },
          py: { xs: 6, md: 8 }
        }}
      >
        <Stack spacing={5}>
          <Box sx={{ textAlign: "center" }}>
            <Typography variant="h4" sx={{ fontWeight: 820, mb: 1 }}>
              为什么选择 HanGuan's SuperAPI
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 560, mx: "auto" }}>
              专为高校师生打造的 LLM API 聚合平台，开箱即用
            </Typography>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
              gap: 2.5
            }}
          >
            <IntroItem
              icon={<SchoolIcon sx={{ fontSize: 32 }} />}
              title="大学生免费"
              text="凭 .edu.cn 教育邮箱注册，完全免费，无任何隐藏费用。"
            />
            <IntroItem
              icon={<AutoAwesomeIcon sx={{ fontSize: 32 }} />}
              title="Token 自由"
              text="不设 Token 上限，不用担心额度用完，尽情探索 AI 能力。"
            />
            <IntroItem
              icon={<ApiIcon sx={{ fontSize: 32 }} />}
              title="Agent 生态适配"
              text="标准 OpenAI 兼容接口，一行配置即可接入 Codex、Claude Code、OpenClaw 等多种 Agent。"
            />
            <IntroItem
              icon={<KeyIcon sx={{ fontSize: 32 }} />}
              title="自助密钥"
              text="登录后在控制台自助创建、轮换 API Key，安全可控。"
            />
          </Box>

          {announcements.length > 0 ? (
            <AnnouncementTimeline announcements={announcements} />
          ) : null}

          <Paper
            variant="outlined"
            sx={{
              p: { xs: 3, md: 4 },
              textAlign: "center",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              border: 0,
              borderRadius: 3
            }}
          >
            <Typography variant="h5" sx={{ fontWeight: 780, mb: 1.5 }}>
              准备好开始了吗？
            </Typography>
            <Typography variant="body1" sx={{ opacity: 0.9, mb: 3, maxWidth: 560, mx: "auto" }}>
              已经有教育邮箱？立即注册，30 秒即可获得专属 API Key。
            </Typography>
            {!user && !admin ? (
              <Button
                variant="contained"
                size="large"
                startIcon={<RocketLaunchIcon />}
                onClick={() => onNavigate("register")}
                sx={{
                  bgcolor: "#fff",
                  color: "#0f766e",
                  fontWeight: 780,
                  px: 4,
                  "&:hover": { bgcolor: "#f0fdfa" }
                }}
              >
                免费注册
              </Button>
            ) : (
              <Button
                variant="contained"
                size="large"
                onClick={() => onNavigate(user ? "portal" : "admin")}
                sx={{
                  bgcolor: "#fff",
                  color: "#0f766e",
                  fontWeight: 780,
                  px: 4,
                  "&:hover": { bgcolor: "#f0fdfa" }
                }}
              >
                进入控制台
              </Button>
            )}
          </Paper>
        </Stack>
      </Box>

      <Box
        component="footer"
        sx={{
          py: 4,
          textAlign: "center",
          borderTop: "1px solid",
          borderColor: "divider",
          color: "text.secondary"
        }}
      >
        <Typography variant="body2">
          HanGuan's SuperAPI · 对大学生免费开放
        </Typography>
      </Box>
    </Box>
  );
}

export function RequireAccountPage({ onNavigate }) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 2,
        py: 4,
        bgcolor: "background.default"
      }}
    >
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 520, p: { xs: 2.25, sm: 3 } }}>
        <Stack spacing={2} alignItems="flex-start">
          <Chip label="需要登录" color="primary" variant="outlined" />
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
