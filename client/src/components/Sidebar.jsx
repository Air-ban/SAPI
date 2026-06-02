import React from "react";
import {
  Drawer,
  Box,
  Toolbar,
  Stack,
  Typography,
  IconButton,
  Chip,
  List,
  Paper,
  Button,
  Tooltip
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import KeyIcon from "@mui/icons-material/Key";
import BarChartIcon from "@mui/icons-material/BarChart";
import ApiIcon from "@mui/icons-material/Api";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import FeedbackIcon from "@mui/icons-material/Feedback";
import SchoolIcon from "@mui/icons-material/School";
import SettingsIcon from "@mui/icons-material/Settings";
import DnsIcon from "@mui/icons-material/Dns";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import LogoutIcon from "@mui/icons-material/Logout";
import RefreshIcon from "@mui/icons-material/Refresh";
import { NavItem } from "./NavItem";
import { DRAWER_WIDTH } from "../constants";

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
  onRefresh
}) {
  const healthMeta = {
    ok: { label: "服务正常", color: "#22c55e" },
    fail: { label: "服务异常", color: "#ef4444" },
    checking: { label: "检查中", color: "#eab308" }
  }[health];
  const portalPages = [
    { id: "overview", icon: <AnalyticsIcon />, primary: "概览", secondary: "Key、模型与端点摘要" },
    { id: "key", icon: <KeyIcon />, primary: "API Key", secondary: "复制、创建与轮换" },
    { id: "usage", icon: <BarChartIcon />, primary: "请求与用量", secondary: "Token 与请求记录" },
    { id: "models", icon: <ApiIcon />, primary: "模型与端点", secondary: "可用模型和接口" },
    { id: "example", icon: <RocketLaunchIcon />, primary: "调用示例", secondary: "curl 请求模板" },
    { id: "suggestion", icon: <FeedbackIcon />, primary: "提建议", secondary: "提交功能建议或反馈" },
    { id: "swagger", icon: <SchoolIcon />, primary: "API 文档", secondary: "Swagger 接口文档（新窗口）" },
    { id: "settings", icon: <SettingsIcon />, primary: "通知设置", secondary: "邮件通知偏好设置" }
  ];
  const adminNavGroups = [
    {
      label: "运营",
      pages: [
        { id: "responses", icon: <DnsIcon />, primary: "代理设置", secondary: "端点、用量、上游地址" },
        { id: "overview", icon: <AnalyticsIcon />, primary: "概览", secondary: "用量、供应商、用户摘要" },
        { id: "usage", icon: <BarChartIcon />, primary: "请求与用量", secondary: "全局统计和明细" },
        { id: "providers", icon: <ApiIcon />, primary: "上游供应商", secondary: "API、模型和密钥" },
        { id: "users", icon: <KeyIcon />, primary: "用户账号", secondary: "用户 Key 与权限" },
        { id: "announcements", icon: <CampaignOutlinedIcon />, primary: "公告管理", secondary: "发布和管理系统公告" },
        { id: "suggestions", icon: <FeedbackIcon />, primary: "建议反馈", secondary: "查看用户提交的建议" }
      ]
    },
    {
      label: "系统",
      pages: [
        { id: "invitations", icon: <VpnKeyIcon />, primary: "邀请码", secondary: "创建与管理邀请码" },
        { id: "smtp", icon: <SettingsIcon />, primary: "SMTP 设置", secondary: "邮件服务配置" }
      ]
    }
  ];

  return (
    <Stack sx={{ height: "100%", p: 2.25, overflow: "auto" }} spacing={2.5}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          component="img"
          src="https://hanguasapi.oss-cn-beijing.aliyuncs.com/%E5%9B%BE%E7%89%87-removebg-preview.png"
          alt="HanGuan's SuperAPI"
          sx={{
            width: 44,
            height: 44,
            borderRadius: 1.5,
            objectFit: "contain"
          }}
        />
        <Box>
          <Typography variant="h6" sx={{ lineHeight: 1.1 }}>
            HanGuan's SuperAPI
          </Typography>
          <Typography variant="caption" sx={{ color: "#94a3b8" }}>
            LLM API Relay
          </Typography>
        </Box>
      </Stack>

      <List disablePadding sx={{ display: "grid", gap: 1 }}>
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
        <Stack spacing={1.25}>
          <Box sx={{ px: 1, pt: 0.5 }}>
            <Typography variant="caption" sx={{ color: "#94a3b8", fontWeight: 750, textTransform: "uppercase", letterSpacing: "0.06em" }}>
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
            <Stack key={group.label} spacing={1.25}>
              <Box sx={{ px: 1, pt: 0.5 }}>
                <Typography variant="caption" sx={{ color: "#94a3b8", fontWeight: 750, textTransform: "uppercase", letterSpacing: "0.06em" }}>
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
            p: 1.75,
            borderColor: "rgba(255,255,255,0.1)",
            bgcolor: "rgba(255,255,255,0.05)",
            color: "inherit",
            borderRadius: 2.5
          }}
        >
          <Stack spacing={1.25}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 720 }} noWrap>
                {user.name}
              </Typography>
              <Typography variant="caption" sx={{ color: "#94a3b8" }} noWrap>
                {user.username}
              </Typography>
            </Box>
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              startIcon={<LogoutIcon />}
              onClick={onUserLogout}
              sx={{ borderColor: "rgba(255,255,255,0.18)", borderRadius: 2 }}
            >
              退出用户
            </Button>
          </Stack>
        </Paper>
      ) : null}

      <Paper
        variant="outlined"
        sx={{
          p: 1.75,
          borderColor: "rgba(255,255,255,0.1)",
          bgcolor: "rgba(255,255,255,0.05)",
          color: "inherit",
          borderRadius: 2.5
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              bgcolor: healthMeta.color,
              flexShrink: 0,
              boxShadow: `0 0 8px ${healthMeta.color}66`,
              ...(health === "checking" ? pulseSx : {})
            }}
          />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {healthMeta.label}
            </Typography>
            <Typography variant="caption" sx={{ color: "#94a3b8" }}>
              API 服务状态
            </Typography>
          </Box>
          <Tooltip title="刷新状态">
            <IconButton size="small" onClick={onRefresh} sx={{ color: "#cbd5e1" }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>
    </Stack>
  );
}
