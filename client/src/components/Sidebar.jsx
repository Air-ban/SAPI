import React from "react";
import {
  Box,
  Stack,
  Typography,
  IconButton,
  List,
  Paper,
  Button,
  Tooltip
} from "@mui/material";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import KeyIcon from "@mui/icons-material/Key";
import ImageIcon from "@mui/icons-material/Image";
import BarChartIcon from "@mui/icons-material/BarChart";
import ApiIcon from "@mui/icons-material/Api";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import FeedbackIcon from "@mui/icons-material/Feedback";
import SchoolIcon from "@mui/icons-material/School";
import SettingsIcon from "@mui/icons-material/Settings";
import DnsIcon from "@mui/icons-material/Dns";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import ComputerIcon from "@mui/icons-material/Computer";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import LogoutIcon from "@mui/icons-material/Logout";
import RefreshIcon from "@mui/icons-material/Refresh";
import { NavItem } from "./NavItem";
import { ThemeModeToggle } from "./ThemeModeToggle";

const pulseSx = {
  "@keyframes healthPulse": {
    "0%, 100%": { opacity: 1 },
    "50%": { opacity: 0.5 }
  },
  animation: "healthPulse 2s ease-in-out infinite"
};

export function Sidebar({
  route,
  health,
  user,
  admin,
  portalPage,
  adminPage,
  onNavigate,
  onPortalPageChange,
  onAdminPageChange,
  onUserLogout,
  onRefresh,
  themeMode,
  onToggleThemeMode
}) {
  const healthMeta = {
    ok: { label: "服务正常", color: "success.main" },
    fail: { label: "服务异常", color: "error.main" },
    checking: { label: "检查中", color: "warning.main" }
  }[health];

  const portalPages = [
    { id: "overview", icon: <AnalyticsIcon />, primary: "首页概览", secondary: "账号、Key、模型总览" },
    { id: "key", icon: <KeyIcon />, primary: "我的 Key", secondary: "复制、创建、轮换" },
    { id: "billing", icon: <AccountBalanceWalletIcon />, primary: "计费套餐", secondary: "余额、消耗、订阅" },
    { id: "chat", icon: <ChatBubbleOutlineIcon />, primary: "站内 Chat", secondary: "Responses 和媒体" },
    { id: "images", icon: <ImageIcon />, primary: "生图工坊", secondary: "生成、编辑、参考图" },
    { id: "usage", icon: <BarChartIcon />, primary: "我的用量", secondary: "请求记录和 Token" },
    { id: "models", icon: <ApiIcon />, primary: "可用模型", secondary: "模型列表和接口" },
    { id: "example", icon: <RocketLaunchIcon />, primary: "怎么调用", secondary: "直接复制示例" },
    { id: "suggestion", icon: <FeedbackIcon />, primary: "反馈建议", secondary: "提交问题或想法" },
    { id: "swagger", icon: <SchoolIcon />, primary: "接口文档", secondary: "打开 Swagger" },
    { id: "settings", icon: <SettingsIcon />, primary: "通知开关", secondary: "是否接收公告邮件" }
  ];

  const adminNavGroups = [
    {
      label: "日常管理",
      pages: [
        { id: "overview", icon: <AnalyticsIcon />, primary: "后台首页", secondary: "用量、用户、来源总览" },
        { id: "usage", icon: <BarChartIcon />, primary: "用量日志", secondary: "请求明细和统计" },
        { id: "server", icon: <ComputerIcon />, primary: "服务器中控", secondary: "状态、资源、刷新" },
        { id: "users", icon: <KeyIcon />, primary: "用户和 Key", secondary: "账号、权限、限速" },
        { id: "providers", icon: <ApiIcon />, primary: "模型来源", secondary: "上游 API 和模型" },
        { id: "responses", icon: <DnsIcon />, primary: "代理入口", secondary: "端点和转发说明" },
        { id: "announcements", icon: <CampaignOutlinedIcon />, primary: "站内公告", secondary: "发布用户通知" },
        { id: "suggestions", icon: <FeedbackIcon />, primary: "用户反馈", secondary: "查看和回复建议" }
      ]
    },
    {
      label: "站点设置",
      pages: [
        { id: "invitations", icon: <VpnKeyIcon />, primary: "邀请码", secondary: "发放注册名额" },
        { id: "smtp", icon: <SettingsIcon />, primary: "总设置", secondary: "邮箱、注册、维护、限速" }
      ]
    }
  ];

  return (
    <Stack sx={{ height: "100%", p: 1.5, overflow: "auto" }} spacing={2}>
      <Stack direction="row" spacing={1.2} alignItems="center" sx={{ px: 0.5, py: 0.5 }}>
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
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="subtitle2" sx={{ lineHeight: 1.1, color: "text.primary", fontWeight: 600 }}>
            SAPI
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            AI SDK Gateway
          </Typography>
        </Box>
        <ThemeModeToggle
          mode={themeMode}
          onToggle={onToggleThemeMode}
          sx={{ color: "text.primary" }}
        />
      </Stack>

      <List disablePadding sx={{ display: "grid", gap: 0.5 }}>
        {user ? (
          <NavItem
            active={route === "portal"}
            icon={<RocketLaunchIcon />}
            primary="用户前台"
            secondary="Key 和调用"
            onClick={() => onNavigate("portal")}
          />
        ) : null}
        {admin ? (
          <NavItem
            active={route === "admin"}
            icon={<AdminPanelSettingsIcon />}
            primary="管理后台"
            secondary="供应商和用户"
            onClick={() => onNavigate("admin")}
          />
        ) : null}
      </List>

      {route === "portal" && user ? (
        <Stack spacing={1}>
          <Box sx={{ px: 1, pt: 0.5 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.5px" }}>
              用户前台
            </Typography>
          </Box>
          <List disablePadding sx={{ display: "grid", gap: 0.5 }}>
            {portalPages.map((item) => (
              <NavItem
                key={item.id}
                active={portalPage === item.id}
                icon={item.icon}
                primary={item.primary}
                secondary={item.secondary}
                onClick={() => onPortalPageChange(item.id)}
              />
            ))}
          </List>
        </Stack>
      ) : null}

      {route === "admin" && admin ? (
        <Stack spacing={2}>
          {adminNavGroups.map((group) => (
            <Stack key={group.label} spacing={1}>
              <Box sx={{ px: 1, pt: 0.5 }}>
                <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.5px" }}>
                  {group.label}
                </Typography>
              </Box>
              <List disablePadding sx={{ display: "grid", gap: 0.5 }}>
                {group.pages.map((item) => (
                  <NavItem
                    key={item.id}
                    active={adminPage === item.id}
                    icon={item.icon}
                    primary={item.primary}
                    secondary={item.secondary}
                    onClick={() => onAdminPageChange(item.id)}
                  />
                ))}
              </List>
            </Stack>
          ))}
        </Stack>
      ) : null}

      <Box sx={{ flexGrow: 1 }} />

      {user ? (
        <Paper
          variant="outlined"
          sx={{
            p: 1.25,
            borderColor: "app.sidebarBorder",
            bgcolor: "app.sidebarSurface",
            color: "inherit",
            borderRadius: "6px"
          }}
        >
          <Stack spacing={1.25}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {user.name}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
                {user.username}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={<LogoutIcon />}
              onClick={onUserLogout}
              sx={{
                width: "100%",
                borderColor: "app.sidebarBorder",
                color: "text.primary",
                bgcolor: "transparent",
                borderRadius: "6px",
                "&:hover": {
                  bgcolor: "app.sidebarHover",
                  borderColor: "text.primary"
                }
              }}
            >
              退出用户
            </Button>
          </Stack>
        </Paper>
      ) : null}

      <Paper
        variant="outlined"
        sx={{
          p: 1.25,
          borderColor: "app.sidebarBorder",
          bgcolor: "app.sidebarSurface",
          color: "inherit",
          borderRadius: "6px"
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor: healthMeta.color,
              flexShrink: 0,
              boxShadow: (theme) => `0 0 0 3px ${
                health === "ok"
                  ? theme.palette.app.successSoft
                  : health === "fail"
                    ? theme.palette.app.errorSoft
                    : theme.palette.app.warningSoft
              }`,
              ...(health === "checking" ? pulseSx : {})
            }}
          />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {healthMeta.label}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              API 服务状态
            </Typography>
          </Box>
          <Tooltip title="刷新状态">
            <IconButton size="small" onClick={onRefresh} sx={{ color: "text.primary" }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>
    </Stack>
  );
}
