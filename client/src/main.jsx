import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import {
  Alert,
  AppBar,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
  createTheme,
  useMediaQuery
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import ApiIcon from "@mui/icons-material/Api";
import BarChartIcon from "@mui/icons-material/BarChart";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DnsIcon from "@mui/icons-material/Dns";
import EditIcon from "@mui/icons-material/Edit";
import KeyIcon from "@mui/icons-material/Key";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import RefreshIcon from "@mui/icons-material/Refresh";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import MailIcon from "@mui/icons-material/Mail";
import SendIcon from "@mui/icons-material/Send";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import SettingsIcon from "@mui/icons-material/Settings";
import SchoolIcon from "@mui/icons-material/School";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";

const DRAWER_WIDTH = 276;
const ADMIN_TOKEN_KEY = "sapiAdminToken";
const USER_TOKEN_KEY = "sapiUserToken";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0f766e",
      dark: "#0b5f59"
    },
    secondary: {
      main: "#2563eb"
    },
    background: {
      default: "#f5f7fa",
      paper: "#ffffff"
    },
    text: {
      primary: "#17202a",
      secondary: "#64748b"
    },
    divider: "#dce3ea"
  },
  shape: {
    borderRadius: 8
  },
  typography: {
    fontFamily:
      'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
    h4: {
      fontWeight: 760,
      letterSpacing: 0
    },
    h5: {
      fontWeight: 740,
      letterSpacing: 0
    },
    h6: {
      fontWeight: 740,
      letterSpacing: 0
    },
    button: {
      fontWeight: 720,
      letterSpacing: 0
    }
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true
      },
      styleOverrides: {
        root: {
          textTransform: "none"
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none"
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          color: "#64748b",
          fontSize: 12,
          fontWeight: 800,
          textTransform: "uppercase"
        }
      }
    }
  }
});

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  } else {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (options.admin !== false && token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }

  return data;
} // 结束 dividerLineSx 块

function useTencentCaptcha() {
  return { ticket: "", randstr: "", error: "", loading: false, show: () => {}, reset: () => {} };
}

function App() {
  const [route, setRoute] = useState(getInitialRoute);
  const [portalPage, setPortalPage] = useState("overview");
  const [adminPage, setAdminPage] = useState("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [health, setHealth] = useState("checking");
  const [selectedKey, setSelectedKey] = useState("");
  const [adminToken, setAdminToken] = useState(
    localStorage.getItem(ADMIN_TOKEN_KEY) || ""
  );
  const [userToken, setUserToken] = useState(localStorage.getItem(USER_TOKEN_KEY) || "");
  const [userSession, setUserSession] = useState(null);
  const [adminState, setAdminState] = useState(null);
  const [userUsage, setUserUsage] = useState(null);
  const [toast, setToast] = useState({ open: false, message: "", severity: "success" });
  const [confirm, setConfirm] = useState(null);
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [createdKeyInfo, setCreatedKeyInfo] = useState(null);
  const [providerHealth, setProviderHealth] = useState([]);
  const [publicConfig, setPublicConfig] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [activeAnnouncement, setActiveAnnouncement] = useState(null);
  const compact = useMediaQuery(theme.breakpoints.down("md"));

  const showToast = useCallback((message, severity = "success") => {
    setToast({ open: true, message, severity });
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      await request("/api/health", { admin: false });
      setHealth("ok");
    } catch {
      setHealth("fail");
    }
  }, []);

  const loadPublicConfig = useCallback(async () => {
    try {
      const config = await request("/api/public/config", { admin: false });
      setPublicConfig(config);
    } catch {
      setPublicConfig(null);
    }
  }, []);

  const loadAnnouncements = useCallback(async () => {
    try {
      const data = await request("/api/announcements", { admin: false });
      const list = data.announcements || [];
      setAnnouncements(list);
      const dismissed = JSON.parse(localStorage.getItem("sapiDismissedAnnouncements") || "[]");
      const next = list.find((a) => !dismissed.includes(a.id));
      if (next) setActiveAnnouncement(next);
    } catch {
      setAnnouncements([]);
    }
  }, []);

  const loadProviderHealth = useCallback(async () => {
    try {
      const data = await request("/api/health/providers", { admin: false });
      setProviderHealth(data.providers || []);
    } catch {
      setProviderHealth([]);
    }
  }, []);

  const loadAdminState = useCallback(async () => {
    const state = await request("/api/admin/state");
    setAdminState(state);
  }, []);

  const loadUserUsage = useCallback(async () => {
    const token = localStorage.getItem(USER_TOKEN_KEY);
    if (!token) {
      setUserUsage(null);
      return;
    }
    const data = await request("/api/user/usage", { admin: false, token });
    setUserUsage(data);
  }, []);

  const loadUserSession = useCallback(async () => {
    const token = localStorage.getItem(USER_TOKEN_KEY);
    if (!token) {
      setUserSession(null);
      return null;
    }

    const data = await request("/api/user/me", {
      admin: false,
      token
    });
    setUserSession(data);
    setSelectedKey(data.user.apiKey || "");
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken("");
    setAdminState(null);
  }, []);

  const userLogout = useCallback(() => {
    localStorage.removeItem(USER_TOKEN_KEY);
    setUserToken("");
    setUserSession(null);
    setSelectedKey("");
  }, []);

  useEffect(() => {
    const handleHashChange = () => setRoute(getInitialRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    checkHealth();
    loadPublicConfig();
    loadAnnouncements();
  }, [checkHealth, loadPublicConfig, loadAnnouncements]);

  useEffect(() => {
    loadProviderHealth();
    const timer = setInterval(loadProviderHealth, 30000);
    return () => clearInterval(timer);
  }, [loadProviderHealth]);

  useEffect(() => {
    if (route === "admin" && adminToken) {
      loadAdminState().catch((error) => {
        logout();
        showToast(error.message, "error");
      });
    }
  }, [route, adminToken, loadAdminState, logout, showToast]);

  useEffect(() => {
    if (userToken) {
      loadUserSession().catch((error) => {
        userLogout();
        showToast(error.message, "error");
      });
      loadUserUsage().catch(() => setUserUsage(null));
    }
  }, [loadUserSession, loadUserUsage, showToast, userLogout, userToken]);

  const navigate = (nextRoute) => {
    window.location.hash = `#${nextRoute}`;
    setRoute(nextRoute);
    setMobileOpen(false);
  };

  const login = async ({ username, password, captchaTicket, captchaRandstr }) => {
    const data = await request("/api/auth/login", {
      method: "POST",
      admin: false,
      body: { username, password, captchaTicket, captchaRandstr }
    });

    if (data.role === "admin") {
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      localStorage.removeItem(USER_TOKEN_KEY);
      setAdminToken(data.token);
      setUserToken("");
      setUserSession(null);
      setSelectedKey("");
      showToast("已进入管理后台");
      await loadAdminState();
      navigate("admin");
      return;
    }

    localStorage.setItem(USER_TOKEN_KEY, data.token);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setUserToken(data.token);
    setAdminToken("");
    setAdminState(null);
    const session = await request("/api/user/me", {
      admin: false,
      token: data.token
    });
    setUserSession(session);
    setSelectedKey(data.user.apiKey || "");
    showToast("已登录");
    navigate("portal");
  };

  const sendVerificationCode = async (email, purpose = "register", captchaTicket = "", captchaRandstr = "") => {
    await request("/api/auth/send-verification-code", {
      method: "POST",
      admin: false,
      body: { email, purpose, captchaTicket, captchaRandstr }
    });
  };

  const sendForgotPasswordCode = async (email, captchaTicket = "", captchaRandstr = "") => {
    await request("/api/auth/forgot-password/send-code", {
      method: "POST",
      admin: false,
      body: { email, captchaTicket, captchaRandstr }
    });
  };

  const resetPassword = async (email, verificationCode, password, captchaTicket = "", captchaRandstr = "") => {
    await request("/api/auth/forgot-password/reset", {
      method: "POST",
      admin: false,
      body: { email, verificationCode, password, captchaTicket, captchaRandstr }
    });
  };

  const userRegister = async ({ username, email, password, verificationCode, invitationCode, captchaTicket, captchaRandstr }) => {
    const data = await request("/api/auth/register", {
      method: "POST",
      admin: false,
      body: { username, email, password, verificationCode, invitationCode, captchaTicket, captchaRandstr }
    });
    localStorage.setItem(USER_TOKEN_KEY, data.token);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setUserToken(data.token);
    setAdminToken("");
    setAdminState(null);
    const session = await request("/api/user/me", {
      admin: false,
      token: data.token
    });
    setUserSession(session);
    setSelectedKey(data.user.apiKey || "");
    showToast("注册成功");
    navigate("portal");
  };

  const createUserApiKey = async ({ name, allowedModels }) => {
    const data = await request("/api/user/api-key", {
      method: "POST",
      admin: false,
      token: userToken,
      body: { name, allowedModels }
    });
    setUserSession((current) => ({ ...(current || {}), user: data.user }));
    const record = data.user.apiKeys?.slice(-1)[0];
    const createdKey = record?.key || data.user.apiKey || "";
    setSelectedKey(createdKey);
    setCreatedKeyInfo({
      key: createdKey,
      name: record?.name || "API Key",
      allowedModels: record?.allowedModels || []
    });
    showToast("API Key 已创建");
  };

  const rotateUserApiKey = async (keyId) => {
    const path = keyId ? `/api/user/api-keys/${keyId}/rotate` : "/api/user/api-key/rotate";
    const data = await request(path, {
      method: "POST",
      admin: false,
      token: userToken
    });
    setUserSession((current) => ({ ...(current || {}), user: data.user }));
    const rotatedKey = data.user.apiKeys?.find((item) => item.id === keyId)?.key || data.user.apiKey || "";
    setSelectedKey(rotatedKey);
    showToast("API Key 已轮换");
  };

  const updateUserApiKey = async (keyId, body) => {
    const data = await request(`/api/user/api-keys/${keyId}`, {
      method: "PUT",
      admin: false,
      token: userToken,
      body
    });
    setUserSession((current) => ({ ...(current || {}), user: data.user }));
    setSelectedKey(data.user.apiKey || "");
    showToast("API Key 已更新");
  };

  const deleteUserApiKey = async (keyId) => {
    await request(`/api/user/api-keys/${keyId}`, {
      method: "DELETE",
      admin: false,
      token: userToken
    });
    const session = await request("/api/user/me", {
      admin: false,
      token: userToken
    });
    setUserSession(session);
    setSelectedKey(session.user.apiKey || "");
    showToast("API Key 已删除");
  };

  const copyText = async (text) => {
    await navigator.clipboard.writeText(text);
    showToast("已复制");
  };

  const afterAdminChange = async (message) => {
    await loadAdminState();
    showToast(message);
  };

  const dismissAnnouncement = (id) => {
    const dismissed = JSON.parse(localStorage.getItem("sapiDismissedAnnouncements") || "[]");
    if (!dismissed.includes(id)) dismissed.push(id);
    localStorage.setItem("sapiDismissedAnnouncements", JSON.stringify(dismissed));
    const next = announcements.find((a) => a.id !== id && !dismissed.includes(a.id));
    setActiveAnnouncement(next || null);
  };

  const drawer = (
    <Sidebar
      route={route}
      health={health}
      onNavigate={navigate}
      portalPage={portalPage}
      adminPage={adminPage}
      onPortalPageChange={(page) => {
        setPortalPage(page);
        setMobileOpen(false);
      }}
      onAdminPageChange={(page) => {
        setAdminPage(page);
        setMobileOpen(false);
      }}
      user={userSession?.user || null}
      admin={Boolean(adminToken)}
      onUserLogout={() => {
        userLogout();
        showToast("已退出");
      }}
      onRefresh={() => {
        checkHealth()
          .then(() => showToast("已刷新"))
          .catch((error) => showToast(error.message, "error"));
      }}
    />
  );

  const snackbar = (
    <Snackbar
      open={toast.open}
      autoHideDuration={2800}
      onClose={() => setToast((current) => ({ ...current, open: false }))}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
    >
      <Alert
        severity={toast.severity}
        variant="filled"
        onClose={() => setToast((current) => ({ ...current, open: false }))}
        sx={{ width: "100%" }}
      >
        {toast.message}
      </Alert>
    </Snackbar>
  );

  if (route === "home") {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <HomePage
          health={health}
          onNavigate={navigate}
          user={userSession?.user || null}
          admin={Boolean(adminToken)}
          onLogout={() => {
            userLogout();
            logout();
            showToast("已退出");
          }}
        />
        <AnnouncementDialog
          announcement={activeAnnouncement}
          onDismiss={() => dismissAnnouncement(activeAnnouncement?.id)}
        />
        {snackbar}
      </ThemeProvider>
    );
  }

  if (route === "login" || route === "register" || (route === "admin" && !adminToken)) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthPage
          mode={route === "register" ? "register" : "login"}
          onLogin={login}
          onRegister={userRegister}
          onSendCode={sendVerificationCode}
          onSendForgotCode={sendForgotPasswordCode}
          onResetPassword={resetPassword}
          onNavigate={navigate}
          onToast={showToast}
        />
        {snackbar}
      </ThemeProvider>
    );
  }

  if (route === "portal" && userToken && !userSession) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LoadingPage text="正在加载用户控制台" />
        {snackbar}
      </ThemeProvider>
    );
  }

  if (route === "portal" && !userSession) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RequireAccountPage onNavigate={navigate} />
        {snackbar}
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
        <AppBar
          position="fixed"
          color="inherit"
          elevation={0}
          sx={{
            display: { md: "none" },
            borderBottom: "1px solid",
            borderColor: "divider"
          }}
        >
          <Toolbar>
            <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="打开导航">
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" sx={{ ml: 1 }}>
              SAPI
            </Typography>
          </Toolbar>
        </AppBar>

        <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
          <Drawer
            variant={compact ? "temporary" : "permanent"}
            open={compact ? mobileOpen : true}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{
              "& .MuiDrawer-paper": {
                width: DRAWER_WIDTH,
                border: 0,
                bgcolor: "#101820",
                color: "#f8fafc"
              }
            }}
          >
            {drawer}
          </Drawer>
        </Box>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            minWidth: 0,
            pt: { xs: 9, md: 4 },
            px: { xs: 2, sm: 3, lg: 4 },
            pb: 4
          }}
        >
          <Box sx={{ maxWidth: 1220, mx: "auto" }}>
            {route === "portal" ? (
              <PortalView
                page={portalPage}
                config={userSession?.config}
                selectedKey={selectedKey}
                user={userSession?.user || null}
                usage={userUsage}
                providerHealth={providerHealth}
                onNavigate={navigate}
                onUserLogout={() => {
                  userLogout();
                  showToast("已退出");
                }}
                onCreateApiKey={() => setCreateKeyOpen(true)
                }
                onRotateApiKey={(key) =>
                  setConfirm({
                    title: "轮换 API Key",
                    message: "旧 Key 会立即失效。继续？",
                    confirmText: "轮换",
                    action: () => rotateUserApiKey(key?.id)
                  })
                }
                onUpdateApiKey={(keyId, body) =>
                  updateUserApiKey(keyId, body).catch((error) => showToast(error.message, "error"))
                }
                onDeleteApiKey={(key) =>
                  setConfirm({
                    title: "删除 API Key",
                    message: `确认删除 ${key?.name || "该 Key"}？删除后无法恢复。`,
                    confirmText: "删除",
                    danger: true,
                    action: () => deleteUserApiKey(key?.id)
                  })
                }
                onRefresh={() =>
                  Promise.all([loadUserSession(), loadUserUsage(), loadProviderHealth()])
                    .then(() => showToast("已刷新"))
                    .catch((error) => showToast(error.message, "error"))
                }
                onCopy={copyText}
              />
            ) : (
              <AdminView
                page={adminPage}
                state={adminState}
                providerHealth={providerHealth}
                onLogout={() => {
                  logout();
                  showToast("已退出");
                }}
                onCopy={copyText}
                onRefresh={() =>
                  loadAdminState()
                    .then(() => showToast("已刷新"))
                    .catch((error) => showToast(error.message, "error"))
                }
                onConfirm={setConfirm}
                afterChange={afterAdminChange}
                onToast={showToast}
                adminToken={adminToken}
              />
            )}
          </Box>
        </Box>
      </Box>

      <ConfirmDialog
        confirm={confirm}
        onClose={() => setConfirm(null)}
        onError={(error) => showToast(error.message, "error")}
      />
      <CreateApiKeyDialog
        open={createKeyOpen}
        models={userSession?.config?.models || []}
        onClose={() => setCreateKeyOpen(false)}
        onCreate={({ name, allowedModels }) =>
          createUserApiKey({ name, allowedModels })
            .catch((error) => showToast(error.message, "error"))
        }
      />
      <CreatedKeyDialog
        info={createdKeyInfo}
        onClose={() => setCreatedKeyInfo(null)}
        onCopy={copyText}
      />
      <AnnouncementDialog
        announcement={activeAnnouncement}
        onDismiss={() => dismissAnnouncement(activeAnnouncement?.id)}
      />
      {snackbar}
    </ThemeProvider>
  );
}

function HomePage({ health, user, admin, onNavigate, onLogout }) {
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
            sx={{
              width: 38,
              height: 38,
              borderRadius: 1,
              display: "grid",
              placeItems: "center",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              fontWeight: 900
            }}
          >
            S
          </Box>
          <Box>
            <Typography variant="h6" sx={{ lineHeight: 1 }}>
              SAPI
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
          background: "linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #14b8a6 100%)",
          color: "#fff",
          py: { xs: 8, md: 12 },
          px: { xs: 2, sm: 3, lg: 5 },
          textAlign: "center",
          position: "relative",
          overflow: "hidden"
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
                  color: "#0f766e",
                  fontWeight: 780,
                  px: 4,
                  py: 1.2,
                  fontSize: "1.05rem",
                  "&:hover": { bgcolor: "#f0fdfa" }
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
              为什么选择 SAPI
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
          SAPI - LLM API Relay · 对大学生免费开放
        </Typography>
      </Box>
    </Box>
  );
}

function IntroItem({ icon, title, text }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Stack spacing={1}>
        <Box sx={{ color: "primary.main", display: "flex" }}>{icon}</Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 780 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
          {text}
        </Typography>
      </Stack>
    </Paper>
  );
}

function RequireAccountPage({ onNavigate }) {
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

function LoadingPage({ text }) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default"
      }}
    >
      <Stack spacing={1.5} alignItems="center">
        <CircularProgress size={28} />
        <Typography color="text.secondary">{text}</Typography>
      </Stack>
    </Box>
  );
}

function ForgotPasswordDialog({ open, onClose, onSendCode, onReset, onToast }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setEmail("");
      setCode("");
      setPassword("");
      setConfirmPassword("");
      setCountdown(0);
    }
  }, [open]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendCode = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      onToast("请输入有效的邮箱地址", "warning");
      return;
    }
    setCodeLoading(true);
    try {
      await onSendCode(email);
      setCountdown(60);
      onToast("验证码已发送", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setCodeLoading(false);
    }
  };

  const handleReset = async () => {
    if (password !== confirmPassword) {
      onToast("两次输入的密码不一致", "warning");
      return;
    }
    if (password.length < 8) {
      onToast("密码至少 8 个字符", "warning");
      return;
    }

    setLoading(true);
    try {
      await onReset(email, code, password);
      onToast("密码重置成功，请登录", "success");
      onClose();
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>重置密码</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {step === 1 ? (
            <>
              <Typography variant="body2" color="text.secondary">
                输入注册时使用的邮箱地址，我们将发送验证码用于重置密码。
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  label="邮箱"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your-email@example.com"
                  sx={{ flex: 1 }}
                  autoFocus
                />
                <Button
                  variant="outlined"
                  onClick={sendCode}
                  disabled={codeLoading || countdown > 0}
                  sx={{ minWidth: 120, height: 56 }}
                >
                  {countdown > 0 ? `${countdown} 秒` : "获取验证码"}
                </Button>
              </Stack>
              <TextField
                label="验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6 位数字"
              />
              <Button
                variant="contained"
                onClick={() => {
                  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    onToast("请输入有效的邮箱地址", "warning");
                    return;
                  }
                  if (!/^\d{6}$/.test(code)) {
                    onToast("请输入 6 位数字验证码", "warning");
                    return;
                  }
                  setStep(2);
                }}
              >
                下一步
              </Button>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                请设置新密码。
              </Typography>
              <TextField
                label="新密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText="至少 8 个字符。"
                autoFocus
              />
              <TextField
                label="确认新密码"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <Stack direction="row" spacing={1}>
                <Button onClick={() => setStep(1)} color="inherit">上一步</Button>
                <Button
                  variant="contained"
                  onClick={handleReset}
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} /> : null}
                >
                  重置密码
                </Button>
              </Stack>
            </>
          )}

        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">取消</Button>
      </DialogActions>
    </Dialog>
  );
}

function AuthPage({
  mode,
  onLogin,
  onRegister,
  onSendCode,
  onSendForgotCode,
  onResetPassword,
  onNavigate,
  onToast
}) {
  const isRegister = mode === "register";
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    verificationCode: "",
    invitationCode: ""
  });
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [registerMethod, setRegisterMethod] = useState("edu");
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    setAgreed(false);
  }, [mode]);

  const sendCode = async () => {
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      onToast("请输入有效的邮箱地址", "warning");
      return;
    }
    setCodeLoading(true);
    try {
      await onSendCode(form.email, "register");
      setCountdown(60);
      onToast("验证码已发送", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setCodeLoading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();

    if (!agreed) {
      onToast("请先同意用户协议和隐私政策", "warning");
      return;
    }

    if (isRegister) {
      if (form.password !== form.confirmPassword) {
        onToast("两次输入的密码不一致", "warning");
        return;
      }
      if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        onToast("请输入有效的邮箱地址", "warning");
        return;
      }
      if (registerMethod === "edu" && !form.email.endsWith(".edu.cn")) {
        onToast("教育邮箱注册需要使用 .edu.cn 后缀的邮箱", "warning");
        return;
      }
      if (registerMethod === "invite" && !form.invitationCode.trim()) {
        onToast("请输入邀请码", "warning");
        return;
      }
      if (!/^\d{6}$/.test(form.verificationCode)) {
        onToast("验证码为 6 位数字", "warning");
        return;
      }
    }

    setLoading(true);
    try {
      if (isRegister) {
        await onRegister({
          username: form.username,
          email: form.email,
          password: form.password,
          verificationCode: form.verificationCode,
          invitationCode: form.invitationCode
        });
      } else {
        await onLogin({
          username: form.username,
          password: form.password
        });
      }
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
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
        <Paper
          variant="outlined"
          sx={{
            width: "100%",
            maxWidth: 440,
            p: { xs: 2.25, sm: 3 },
            boxShadow: "0 18px 46px rgba(15, 23, 42, 0.08)"
          }}
        >
          <Stack spacing={2.2}>
            <Stack spacing={1} alignItems="center" textAlign="center">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 1,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "primary.main",
                  color: "primary.contrastText"
                }}
              >
                {isRegister ? <PersonAddIcon /> : <LoginIcon />}
              </Box>
              <Box>
                <Typography variant="h5">
                  {isRegister ? "注册 SAPI 账号" : "登录 SAPI"}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {isRegister
                    ? "注册后进入用户控制台，自助创建 API Key。"
                    : "登录 SAPI 用户控制台。"}
                </Typography>
              </Box>
            </Stack>

            <Box component="form" onSubmit={submit}>
              <Stack spacing={1.5}>
                <TextField
                  label={isRegister ? "用户名" : "用户名或邮箱"}
                  value={form.username}
                  onChange={update("username")}
                  autoComplete="username"
                  placeholder={isRegister ? "字母、数字、点、下划线、@、短横线" : "用户名或邮箱"}
                  required
                />
                {isRegister ? (
                  <TextField
                    label="邮箱"
                    type="email"
                    value={form.email}
                    onChange={update("email")}
                    placeholder="your-email@example.com"
                    required
                  />
                ) : null}
                <TextField
                  label="密码"
                  type="password"
                  value={form.password}
                  onChange={update("password")}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  required
                  helperText={isRegister ? "至少 8 个字符。" : ""}
                />
                {isRegister ? (
                  <TextField
                    label="确认密码"
                    type="password"
                    value={form.confirmPassword}
                    onChange={update("confirmPassword")}
                    autoComplete="new-password"
                    required
                  />
                ) : null}
                {isRegister ? (
                  <Stack direction="row" spacing={1}>
                    <TextField
                      label="邮箱验证码"
                      value={form.verificationCode}
                      onChange={update("verificationCode")}
                      placeholder="6 位数字"
                      required
                      sx={{ flex: 1 }}
                    />
                    <Button
                      variant="outlined"
                      onClick={sendCode}
                      disabled={codeLoading || countdown > 0}
                      sx={{ minWidth: 120, height: 56 }}
                    >
                      {countdown > 0 ? `${countdown} 秒` : "获取验证码"}
                    </Button>
                  </Stack>
                ) : null}
                {isRegister ? (
                  <>
                    <DividerLine />
                    <ToggleButtonGroup
                      value={registerMethod}
                      exclusive
                      fullWidth
                      size="small"
                      onChange={(_, value) => {
                        if (value) setRegisterMethod(value);
                      }}
                    >
                      <ToggleButton value="edu">教育邮箱注册</ToggleButton>
                      <ToggleButton value="invite">邀请码注册</ToggleButton>
                    </ToggleButtonGroup>
                    {registerMethod === "invite" ? (
                      <TextField
                        label="邀请码"
                        value={form.invitationCode}
                        onChange={update("invitationCode")}
                        placeholder="输入管理员提供的邀请码"
                        required
                        helperText="使用管理员提供的邀请码进行注册。"
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            bgcolor: 'rgba(15,118,110,0.04)'
                          }
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        使用 .edu.cn 教育邮箱注册，无需邀请码。
                      </Typography>
                    )}
                  </>
                ) : null}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2" color="text.secondary">
                      我已阅读并同意
                      <Button size="small" sx={{ p: 0, minWidth: 0, verticalAlign: "baseline" }} onClick={() => setTermsOpen(true)}>
                        《用户协议与隐私政策》
                      </Button>
                    </Typography>
                  }
                />
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  startIcon={isRegister ? <PersonAddIcon /> : <LoginIcon />}
                  disabled={loading}
                >
                  {isRegister ? "注册" : "登录"}
                </Button>
                {!isRegister ? (
                  <Box sx={{ textAlign: "center" }}>
                    <Button size="small" onClick={() => setForgotOpen(true)}>
                      忘记密码？
                    </Button>
                  </Box>
                ) : null}
              </Stack>
            </Box>

            <DividerLine />
            <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap">
              <Button
                size="small"
                onClick={() => onNavigate(isRegister ? "login" : "register")}
              >
                {isRegister ? "已有账号，去登录" : "没有账号，去注册"}
              </Button>
              <Button size="small" color="inherit" onClick={() => onNavigate("home")}>
                返回首页
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Box>
      <ForgotPasswordDialog
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        onSendCode={onSendForgotCode}
        onReset={onResetPassword}
        onToast={onToast}
      />
      <Dialog open={termsOpen} onClose={() => setTermsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>用户协议与隐私政策</DialogTitle>
        <DialogContent>
          <DialogContentText component="div" sx={{ whiteSpace: "pre-line" }}>
            <Typography variant="subtitle2" gutterBottom>一、用户协议</Typography>
            <Typography variant="body2" paragraph>
              1. 服务说明：本服务提供 API 代理转发功能，用户可通过创建 API Key 调用第三方大模型服务。
            </Typography>
            <Typography variant="body2" paragraph>
              2. 使用规范：用户不得利用本服务从事违法违规活动，不得滥用 API 接口。
            </Typography>
            <Typography variant="body2" paragraph>
              3. 数据承诺：我们不会将用户的任何数据（包括但不限于 API 请求内容、响应内容、用量数据）用于训练人工智能模型或任何机器学习目的。
            </Typography>
            <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>二、隐私政策</Typography>
            <Typography variant="body2" paragraph>
              1. 信息收集：我们仅收集提供服务所必需的最少信息，包括用户名、邮箱地址、密码哈希及 API 用量统计。
            </Typography>
            <Typography variant="body2" paragraph>
              2. 隐私保护：我们不会收集、存储或分析用户的 API 请求内容（Prompt 和 Response）。所有请求仅作为代理转发，不做持久化存储。
            </Typography>
            <Typography variant="body2" paragraph>
              3. 数据安全：用户数据采用加密存储，仅用于身份验证、用量统计和服务运营，不会向任何第三方披露或出售。
            </Typography>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTermsOpen(false)}>关闭</Button>
          <Button
            variant="contained"
            onClick={() => {
              setAgreed(true);
              setTermsOpen(false);
            }}
          >
            同意
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function Sidebar({
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
    { id: "example", icon: <RocketLaunchIcon />, primary: "调用示例", secondary: "curl 请求模板" }
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
        { id: "announcements", icon: <CampaignOutlinedIcon />, primary: "公告管理", secondary: "发布和管理系统公告" }
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
          sx={{
            width: 44,
            height: 44,
            borderRadius: 1,
            display: "grid",
            placeItems: "center",
            bgcolor: "#d7fff8",
            color: "#0f4d49",
            fontWeight: 900,
            fontSize: 20
          }}
        >
          S
        </Box>
        <Box>
          <Typography variant="h6" sx={{ lineHeight: 1.1 }}>
            SAPI
          </Typography>
          <Typography variant="caption" sx={{ color: "#aab7c4" }}>
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
          <Typography variant="caption" sx={{ px: 1, color: "#7f91a4", fontWeight: 800, textTransform: "uppercase" }}>
            用户前台
          </Typography>
          <List disablePadding sx={{ display: "grid", gap: 1 }}>
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
              <Typography variant="caption" sx={{ px: 1, color: "#7f91a4", fontWeight: 800, textTransform: "uppercase" }}>
                {group.label}
              </Typography>
              <List disablePadding sx={{ display: "grid", gap: 1 }}>
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
            p: 1.5,
            borderColor: "rgba(255,255,255,0.12)",
            bgcolor: "rgba(255,255,255,0.06)",
            color: "inherit"
          }}
        >
          <Stack spacing={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 760 }} noWrap>
                {user.name}
              </Typography>
              <Typography variant="caption" sx={{ color: "#aab7c4" }} noWrap>
                {user.username}
              </Typography>
            </Box>
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              startIcon={<LogoutIcon />}
              onClick={onUserLogout}
              sx={{ borderColor: "rgba(255,255,255,0.22)" }}
            >
              退出用户
            </Button>
          </Stack>
        </Paper>
      ) : null}

      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          borderColor: "rgba(255,255,255,0.12)",
          bgcolor: "rgba(255,255,255,0.06)",
          color: "inherit"
        }}
      >
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Box
            sx={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              bgcolor: healthMeta.color,
              flexShrink: 0
            }}
          />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 720 }}>
              {healthMeta.label}
            </Typography>
            <Typography variant="caption" sx={{ color: "#aab7c4" }}>
              API 服务状态
            </Typography>
          </Box>
          <Tooltip title="刷新状态">
            <IconButton size="small" onClick={onRefresh} sx={{ color: "#d8e1ea" }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>
    </Stack>
  );
}

function NavItem({ active, icon, primary, secondary, onClick }) {
  return (
    <ListItemButton
      selected={active}
      onClick={onClick}
      sx={{
        borderRadius: 1,
        border: "1px solid",
        borderColor: active ? "rgba(255,255,255,0.14)" : "transparent",
        color: "#d8e1ea",
        "&.Mui-selected": {
          bgcolor: "rgba(255,255,255,0.1)",
          color: "#ffffff"
        },
        "&.Mui-selected:hover, &:hover": {
          bgcolor: "rgba(255,255,255,0.12)"
        }
      }}
    >
      <ListItemIcon sx={{ color: active ? "#9ee8dc" : "#8fa1b3", minWidth: 38 }}>
        {icon}
      </ListItemIcon>
      <ListItemText
        primary={primary}
        secondary={secondary}
        primaryTypographyProps={{ fontWeight: 740 }}
        secondaryTypographyProps={{ color: "#9aa8b6", fontSize: 12 }}
      />
    </ListItemButton>
  );
}

function PortalView({
  page = "overview",
  config,
  selectedKey,
  user,
  usage,
  providerHealth,
  onNavigate,
  onUserLogout,
  onCreateApiKey,
  onRotateApiKey,
  onUpdateApiKey,
  onDeleteApiKey,
  onRefresh,
  onCopy
}) {
  const effectiveConfig = config || {
    baseUrl: window.location.origin,
    endpoints: [],
    models: []
  };
  const apiKeys = getUserApiKeys(user);
  const displayKey = selectedKey || apiKeys[0]?.key || user?.apiKey || "sk-sapi-REPLACE_WITH_YOUR_KEY";
  const firstModel = effectiveConfig.models[0];
  const model = (firstModel && typeof firstModel === "object" ? firstModel.id : firstModel) || "gpt-4o-mini";
  const curlExample = [
    `curl ${effectiveConfig.baseUrl}/v1/chat/completions \\`,
    `  -H "Authorization: Bearer ${displayKey}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"hello"}]}'`
  ].join("\n");
  const currentPage = ["overview", "key", "usage", "models", "example"].includes(page)
    ? page
    : "overview";
  const pageMeta = {
    overview: { title: "可调用 API", description: "API Key、模型和端点摘要。" },
    key: { title: "API Key", description: "管理你的 SAPI 调用密钥。" },
    usage: { title: "请求与用量", description: "查看 Token 用量和请求记录。" },
    models: { title: "模型与端点", description: "查看当前可用模型和 OpenAI 兼容端点。" },
    example: { title: "调用示例", description: "复制可直接执行的 curl 请求。" }
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

      {currentPage === "overview" && usage?.byHour?.length > 0 ? (
        <Section title="最近 24 小时 Token 用量" icon={<BarChartIcon />}>
          <TokenUsageChart data={usage.byHour} />
        </Section>
      ) : null}

      {providerHealth.length > 0 && ["overview", "models"].includes(currentPage) ? (
        <ProviderHealthSection providers={providerHealth} />
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
              <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={onCreateApiKey}>
                新增 Key
              </Button>
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
                  你还没有 API Key。创建后即可调用 SAPI 的 /v1 接口。
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

        {["overview", "models"].includes(currentPage) ? (
        <Section title="可用模型" icon={<ApiIcon />}>
          {effectiveConfig.models.length ? (
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {effectiveConfig.models.map((item) => {
                const id = item?.id || item;
                const name = item?.name || id;
                const description = item?.description || "";
                const chip = <Chip key={id} label={name} color="primary" variant="outlined" />;
                return description ? (
                  <Tooltip key={id} title={description} arrow>
                    <span>{chip}</span>
                  </Tooltip>
                ) : (
                  chip
                );
              })}
            </Stack>
          ) : (
            <EmptyState text="管理员还没有配置可用模型。" />
          )}
        </Section>
        ) : null}
      </Box>
      ) : null}

      {currentPage === "usage" && usage ? (
        <UsageSection usage={usage} />
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
    </Stack>
  );
}

function ApiKeyCard({ apiKey, usage, onCopy, onRotate, onToggle, onDelete }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
        gap: 1.5,
        alignItems: "center",
        bgcolor: "#fbfcfe"
      }}
    >
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {apiKey.name || "API Key"}
          </Typography>
          <Chip
            size="small"
            label={apiKey.enabled ? "启用" : "停用"}
            color={apiKey.enabled ? "success" : "warning"}
            variant="outlined"
          />
          {usage ? (
            <Chip
              size="small"
              label={`请求 ${usage.requests} 次 / ${formatNumber(usage.totalTokens)} tokens`}
              variant="outlined"
            />
          ) : null}
        </Stack>
        {apiKey.allowedModels?.length > 0 ? (
          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              可用模型：
            </Typography>
            {apiKey.allowedModels.map((model) => (
              <Chip key={model} label={model} size="small" variant="outlined" color="primary" />
            ))}
          </Stack>
        ) : null}
        <Box component="code" sx={{ ...inlineCodeSx, display: "block", p: 1.1, mx: 0 }}>
          {apiKey.key || apiKey.preview || "-"}
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Typography variant="caption" color="text.secondary">
            创建：{formatDate(apiKey.createdAt)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            最近使用：{formatDate(apiKey.lastUsedAt)}
          </Typography>
        </Stack>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center" justifyContent={{ xs: "flex-start", md: "flex-end" }}>
        <Tooltip title="复制 Key">
          <IconButton onClick={() => onCopy(apiKey.key)} disabled={!apiKey.key}>
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="轮换 Key">
          <IconButton onClick={onRotate}>
            <RotateRightIcon />
          </IconButton>
        </Tooltip>
        {onDelete ? (
          <Tooltip title="删除 Key">
            <IconButton color="error" onClick={onDelete}>
              <DeleteOutlineIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        <FormControlLabel
          control={<Switch checked={apiKey.enabled} onChange={onToggle} />}
          label=""
          sx={{ m: 0 }}
        />
      </Stack>
    </Paper>
  );
}

function UsageSection({ usage }) {
  if (!usage) return null;
  const hasData = usage.requests > 0;
  const recentRequests = usage.recentRequests || usage.recent || [];
  const showUserColumn = recentRequests.some((request) => request.userName || request.username || request.userId);
  const showKeyColumn = recentRequests.some((request) => request.apiKeyName || request.apiKeyPreview || request.apiKeyId);

  return (
    <Section title="Token 用量统计（近 30 天）" icon={<BarChartIcon />}>
      {!hasData ? (
        <EmptyState text="暂无调用记录。" />
      ) : (
        <Stack spacing={2}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
              gap: 2
            }}
          >
            <Metric icon={<AnalyticsIcon />} label="总请求数" value={usage.requests} />
            <Metric icon={<DnsIcon />} label="Input Tokens" value={formatNumber(usage.totalPromptTokens)} />
            <Metric icon={<RocketLaunchIcon />} label="Output Tokens" value={formatNumber(usage.totalCompletionTokens)} />
            <Metric icon={<CheckCircleIcon />} label="缓存命中 Tokens" value={formatNumber(usage.totalCachedTokens)} />
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
              gap: 2
            }}
          >
            {(usage.byApiKey || []).length > 0 ? (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 780 }}>
                  按 API Key 统计
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>API Key</TableCell>
                        <TableCell>用户</TableCell>
                        <TableCell align="right">请求</TableCell>
                        <TableCell align="right">输入</TableCell>
                        <TableCell align="right">输出</TableCell>
                        <TableCell align="right">Tokens</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {usage.byApiKey.map((row) => (
                        <TableRow key={`${row.userId}-${row.apiKeyId || row.apiKeyPreview}`} hover>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 760 }} noWrap title={row.apiKeyName}>
                              {row.apiKeyName || "未知 Key"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap title={row.apiKeyPreview}>
                              {row.apiKeyPreview || "-"}
                            </Typography>
                          </TableCell>
                          <TableCell>{formatUserName(row)}</TableCell>
                          <TableCell align="right">{row.requests}</TableCell>
                          <TableCell align="right">{formatNumber(row.promptTokens)}</TableCell>
                          <TableCell align="right">{formatNumber(row.completionTokens)}</TableCell>
                          <TableCell align="right">{formatNumber(row.totalTokens)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            ) : null}
            {usage.byModel.length > 0 ? (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 780 }}>
                  按模型统计
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>模型</TableCell>
                        <TableCell align="right">请求</TableCell>
                        <TableCell align="right">输入</TableCell>
                        <TableCell align="right">输出</TableCell>
                        <TableCell align="right">缓存命中</TableCell>
                        <TableCell align="right">Tokens</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {usage.byModel.map((row) => (
                        <TableRow key={row.model} hover>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontFamily: 'Consolas, monospace' }} noWrap>
                              {row.model}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{row.requests}</TableCell>
                          <TableCell align="right">{formatNumber(row.promptTokens)}</TableCell>
                          <TableCell align="right">{formatNumber(row.completionTokens)}</TableCell>
                          <TableCell align="right">{formatNumber(row.cachedTokens)}</TableCell>
                          <TableCell align="right">{formatNumber(row.totalTokens)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            ) : null}
            {usage.byDay.length > 0 ? (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 780 }}>
                  按天统计
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>日期</TableCell>
                        <TableCell align="right">请求</TableCell>
                        <TableCell align="right">输入</TableCell>
                        <TableCell align="right">输出</TableCell>
                        <TableCell align="right">缓存命中</TableCell>
                        <TableCell align="right">Tokens</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {usage.byDay.slice(-14).map((row) => (
                        <TableRow key={row.day} hover>
                          <TableCell>{row.day}</TableCell>
                          <TableCell align="right">{row.requests}</TableCell>
                          <TableCell align="right">{formatNumber(row.promptTokens)}</TableCell>
                          <TableCell align="right">{formatNumber(row.completionTokens)}</TableCell>
                          <TableCell align="right">{formatNumber(row.cachedTokens)}</TableCell>
                          <TableCell align="right">{formatNumber(row.totalTokens)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            ) : null}
          </Box>
          {recentRequests.length > 0 ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 780 }}>
                最近请求记录
              </Typography>
              <TableContainer>
                <Table size="small" sx={{ minWidth: showUserColumn || showKeyColumn ? 1240 : 1040 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>时间</TableCell>
                      {showUserColumn ? <TableCell>用户</TableCell> : null}
                      {showKeyColumn ? <TableCell>API Key</TableCell> : null}
                      <TableCell>状态</TableCell>
                      <TableCell>模型</TableCell>
                      <TableCell>端点</TableCell>
                      <TableCell align="right">输入</TableCell>
                      <TableCell align="right">输出</TableCell>
                      <TableCell align="right">缓存命中</TableCell>
                      <TableCell align="right">缓存写入</TableCell>
                      <TableCell align="right">总 Tokens</TableCell>
                      <TableCell align="right">耗时</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentRequests.map((request) => (
                      <TableRow key={request.id} hover title={request.errorMessage || ""}>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(request.timestamp)}</TableCell>
                        {showUserColumn ? (
                          <TableCell>
                            {formatUserName(request)}
                          </TableCell>
                        ) : null}
                        {showKeyColumn ? (
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 760 }} noWrap title={request.apiKeyName}>
                              {request.apiKeyName || "-"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap title={request.apiKeyPreview}>
                              {request.apiKeyPreview || ""}
                            </Typography>
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <Chip
                            size="small"
                            label={request.status || (request.ok ? "OK" : "ERR")}
                            color={requestStatusColor(request)}
                            variant={request.ok ? "outlined" : "filled"}
                            sx={{ fontWeight: 800, minWidth: 62 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'Consolas, monospace' }} noWrap title={request.upstreamModel ? `${request.model} → ${request.upstreamModel}` : request.model}>
                            {request.model || "unknown"}
                            {request.upstreamModel && request.upstreamModel !== request.model ? (
                              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                → {request.upstreamModel}
                              </Typography>
                            ) : null}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                            {request.method ? <Chip size="small" label={request.method} variant="outlined" /> : null}
                            {request.stream ? <Chip size="small" label="stream" color="secondary" variant="outlined" /> : null}
                            <Typography variant="body2" noWrap title={request.endpoint}>
                              {request.endpoint || "-"}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">{formatNumber(request.promptTokens)}</TableCell>
                        <TableCell align="right">{formatNumber(request.completionTokens)}</TableCell>
                        <TableCell align="right">{cacheHitText(request)}</TableCell>
                        <TableCell align="right">{formatNumber(request.cacheCreationTokens)}</TableCell>
                        <TableCell align="right">{formatNumber(request.totalTokens)}</TableCell>
                        <TableCell align="right">{formatDuration(request.durationMs)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          ) : null}
        </Stack>
      )}
    </Section>
  );
}

function TokenUsageChart({ data }) {
  const chartData = data.map((item) => ({
    ...item,
    label: item.hour.slice(11, 16)
  }));

  return (
    <Box sx={{ width: "100%", height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <RechartsTooltip
            formatter={(value, name) => {
              const labelMap = {
                promptTokens: "Input Tokens",
                completionTokens: "Output Tokens",
                totalTokens: "总 Tokens",
                requests: "请求数"
              };
              return [Number(value).toLocaleString(), labelMap[name] || name];
            }}
            labelFormatter={(label) => `${label}`}
            contentStyle={{ borderRadius: 8, border: "1px solid #dce3ea" }}
          />
          <Legend
            formatter={(value) => {
              const labelMap = {
                promptTokens: "Input Tokens",
                completionTokens: "Output Tokens",
                totalTokens: "总 Tokens",
                requests: "请求数"
              };
              return labelMap[value] || value;
            }}
          />
          <Bar dataKey="promptTokens" stackId="a" fill="#0f766e" radius={[0, 0, 0, 0]} />
          <Bar dataKey="completionTokens" stackId="a" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

function ProxySettingsSection({ state, usage, providers, onCopy, onAddProvider, onEditProvider }) {
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

function AdminView({
  page = "overview",
  state,
  providerHealth,
  onLogout,
  onCopy,
  onRefresh,
  onConfirm,
  afterChange,
  onToast,
  adminToken
}) {
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);

  const providers = state?.providers || [];
  const users = state?.users || [];
  const usage = state?.usage;
  const currentPage = ["overview", "usage", "providers", "responses", "users", "invitations", "smtp", "announcements"].includes(page)
    ? page
    : "overview";
  const pageMeta = {
    overview: { title: "上游 API 与用户 Key", description: "供应商、用户和用量摘要。" },
    usage: { title: "请求与用量", description: "查看全局 Token 统计和最近请求。" },
    providers: { title: "上游供应商", description: "配置模型来源、密钥和启用状态。" },
    users: { title: "用户账号", description: "管理用户 Key 和访问状态。" },
    invitations: { title: "邀请码管理", description: "创建、发送和管理邀请码。" },
    smtp: { title: "SMTP 设置", description: "配置邮件发送服务。" },
    announcements: { title: "公告管理", description: "发布和管理系统公告。" }
  }[currentPage] || {
    title: "上游 API 与用户 Key",
    description: "供应商、用户和用量摘要。"
  };

  return (
    <Stack spacing={2.5}>
      <PageHeader
        eyebrow="管理后台"
        title={currentPage === "responses" ? "代理设置" : pageMeta.title}
        description={currentPage === "responses" ? "查看对外端点、用量概览，并维护上游 /v1 地址。" : pageMeta.description}
        action={
          <Stack direction="row" spacing={1}>
            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={onRefresh}>
              刷新
            </Button>
            <Button startIcon={<LogoutIcon />} color="inherit" variant="outlined" onClick={onLogout}>
              退出
            </Button>
          </Stack>
        }
      />

      {currentPage === "overview" ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
            gap: 2
          }}
        >
          <Metric icon={<BarChartIcon />} label="总请求数" value={formatNumber(usage?.requests || 0)} />
          <Metric icon={<AnalyticsIcon />} label="总 Tokens" value={formatNumber(usage?.totalTokens || 0)} />
          <Metric icon={<DnsIcon />} label="上游供应商" value={providers.length} />
          <Metric icon={<KeyIcon />} label="用户账号" value={users.length} />
        </Box>
      ) : null}

      {providerHealth.length > 0 && currentPage === "overview" ? (
        <ProviderHealthSection providers={providerHealth} />
      ) : null}

      {currentPage === "usage" && usage ? <UsageSection usage={usage} /> : null}

      {currentPage === "responses" ? (
        <ProxySettingsSection
          state={state}
          usage={usage}
          providers={providers}
          onCopy={onCopy}
          onAddProvider={() => setProviderDialogOpen(true)}
          onEditProvider={{
            afterChange,
            onConfirm,
            onToast,
            open: (provider) => {
              setEditingProvider(provider);
              setProviderDialogOpen(true);
            }
          }}
        />
      ) : null}

      {currentPage === "providers" ? (
        <Section
          title="上游供应商"
          icon={<ApiIcon />}
          action={
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => setProviderDialogOpen(true)}
            >
              添加
            </Button>
          }
        >
          {providers.length ? (
            <Stack spacing={1.5}>
              {providers.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  afterChange={afterChange}
                  onConfirm={onConfirm}
                  onToast={onToast}
                  onEdit={() => {
                    setEditingProvider(provider);
                    setProviderDialogOpen(true);
                  }}
                />
              ))}
            </Stack>
          ) : (
            <EmptyState text="还没有配置上游 API。添加后用户前台会显示对应模型。" />
          )}
        </Section>
      ) : null}

      <ProviderDialog
        open={providerDialogOpen}
        provider={editingProvider}
        onClose={() => {
          setProviderDialogOpen(false);
          setEditingProvider(null);
        }}
        afterChange={afterChange}
        onToast={onToast}
      />

      {currentPage === "users" ? (
        <>
          <Section title="用户账号" icon={<KeyIcon />}>
            {users.length ? (
              <Stack spacing={1.5}>
                {users.map((user) => {
                  const userUsage = usage?.byUser?.find((u) => u.userId === user.id);
                  return (
                    <UserRow
                      key={user.id}
                      user={user}
                      usage={userUsage}
                      afterChange={afterChange}
                      onConfirm={onConfirm}
                      onCopy={onCopy}
                      onToast={onToast}
                    />
                  );
                })}
              </Stack>
            ) : (
              <EmptyState text="还没有注册用户。" />
            )}
          </Section>
          <AdminApiKeysSection
            apiKeys={state?.adminApiKeys || []}
            usage={usage}
            onCopy={onCopy}
            onConfirm={onConfirm}
            afterChange={afterChange}
            onToast={onToast}
          />
        </>
      ) : null}

      {currentPage === "invitations" ? (
        <InvitationCodesSection
          codes={state?.invitationCodes || []}
          afterChange={afterChange}
          onConfirm={onConfirm}
          onCopy={onCopy}
          onToast={onToast}
        />
      ) : null}

      {currentPage === "smtp" ? (
        <SmtpConfigSection
          config={state?.smtpConfig || {}}
          afterChange={afterChange}
          onToast={onToast}
        />
      ) : null}

      {currentPage === "announcements" ? (
        <AnnouncementsSection
          announcements={state?.announcements || []}
          afterChange={afterChange}
          onConfirm={onConfirm}
          onToast={onToast}
        />
      ) : null}
    </Stack>
  );
}

function ProviderDialog({ open, onClose, provider, afterChange, onToast }) {
  const isEdit = Boolean(provider);
  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    enabled: true,
    failoverThreshold: 3
  });
  const [selectedModels, setSelectedModels] = useState([]);
  const [modelSelectionTouched, setModelSelectionTouched] = useState(false);
  const [lookup, setLookup] = useState({ loading: false, error: "", models: [] });
  const [modelMappings, setModelMappings] = useState([]);
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setForm({ name: "", baseUrl: "", apiKey: "", enabled: true, failoverThreshold: 3 });
    setSelectedModels([]);
    setModelSelectionTouched(false);
    setLookup({ loading: false, error: "", models: [] });
    setModelMappings([]);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (provider) {
      setForm({
        name: provider.name || "",
        baseUrl: provider.baseUrl || "",
        apiKey: "",
        enabled: provider.enabled !== false,
        failoverThreshold: typeof provider.failoverThreshold === "number" ? provider.failoverThreshold : 3
      });
      const normalized = (provider.models || []).map((m) => {
        if (m && typeof m === "object") return { id: m.id || "", name: m.name || m.id || "", description: m.description || "" };
        return { id: String(m), name: String(m), description: "" };
      }).filter((m) => m.id);
      setSelectedModels(normalized);
      setModelSelectionTouched(false);
      setLookup({ loading: false, error: "", models: normalized.map((m) => m.id) });
      const mappings = [];
      const rawMappings = provider.modelMappings || {};
      for (const [customId, upstreamId] of Object.entries(rawMappings)) {
        if (customId && upstreamId) mappings.push({ customId, upstreamId });
      }
      setModelMappings(mappings);
    } else {
      reset();
    }
  }, [open, provider, reset]);

  const closeDialog = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const update = (field) => (event) => {
    const value = field === "enabled" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toggleModel = (modelId) => {
    setModelSelectionTouched(true);
    setSelectedModels((current) => {
      const exists = current.some((m) => m.id === modelId);
      if (exists) {
        return current.filter((m) => m.id !== modelId);
      }
      return [...current, { id: modelId, name: modelId, description: "" }];
    });
  };

  const updateModelName = (modelId, name) => {
    setSelectedModels((current) =>
      current.map((m) => (m.id === modelId ? { ...m, name: name || m.id } : m))
    );
  };

  const updateModelDescription = (modelId, description) => {
    setSelectedModels((current) =>
      current.map((m) => (m.id === modelId ? { ...m, description: description || "" } : m))
    );
  };

  const fetchModels = useCallback(
    async ({ force = false, signal } = {}) => {
      const baseUrl = form.baseUrl.trim();
      const apiKey = form.apiKey.trim();

      if (!baseUrl || !apiKey) {
        setLookup({ loading: false, error: "", models: [] });
        if (!isEdit) {
          setSelectedModels([]);
          setModelSelectionTouched(false);
        }
        return;
      }

      try {
        new URL(baseUrl);
      } catch {
        setLookup({ loading: false, error: "", models: [] });
        if (!isEdit) {
          setSelectedModels([]);
          setModelSelectionTouched(false);
        }
        return;
      }

      setLookup((current) => ({ ...current, loading: true, error: "" }));
      try {
        const data = await request("/api/admin/providers/models", {
          method: "POST",
          body: { baseUrl, apiKey },
          signal
        });
        const models = data.models || [];

        setLookup({ loading: false, error: "", models });
        setSelectedModels((current) => {
          if (!models.length) return [];
          if (!force && modelSelectionTouched) {
            return current.filter((m) => models.includes(m.id));
          }
          return models.map((id) => {
            const existing = current.find((m) => m.id === id);
            return existing || { id, name: id, description: "" };
          });
        });
        if (force) setModelSelectionTouched(false);
        if (force && !models.length) {
          onToast("上游没有返回模型 ID", "warning");
        }
      } catch (error) {
        if (error.name === "AbortError") return;
        setLookup({ loading: false, error: error.message, models: [] });
      }
    },
    [form.apiKey, form.baseUrl, isEdit, modelSelectionTouched, onToast]
  );

  useEffect(() => {
    if (!open) return undefined;
    if (isEdit) return undefined;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchModels({ signal: controller.signal }).catch((error) => {
        if (error.name === "AbortError") return;
        setLookup({ loading: false, error: error.message, models: [] });
      });
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [fetchModels, open, isEdit]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const mappingsObj = {};
      for (const { customId, upstreamId } of modelMappings) {
        if (customId.trim() && upstreamId.trim()) mappingsObj[customId.trim()] = upstreamId.trim();
      }
      const body = { ...form, models: selectedModels, modelMappings: mappingsObj };
      if (isEdit) {
        await request(`/api/admin/providers/${provider.id}`, {
          method: "PUT",
          body
        });
        closeDialog();
        await afterChange("上游 API 已更新");
      } else {
        await request("/api/admin/providers", {
          method: "POST",
          body
        });
        closeDialog();
        await afterChange("上游 API 已保存");
      }
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : closeDialog}
      maxWidth="md"
      fullWidth
      PaperProps={{ component: "form", onSubmit: submit }}
    >
      <DialogTitle>{isEdit ? "编辑上游供应商" : "添加上游供应商"}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.8} sx={{ pt: 1 }}>
          <TextField
            label="名称"
            value={form.name}
            onChange={update("name")}
            placeholder="OpenAI / DeepSeek / 自定义网关"
            required
          />
          <TextField
            label="Base URL"
            value={form.baseUrl}
            onChange={update("baseUrl")}
            placeholder="https://api.openai.com/v1"
            required
          />
          <TextField
            label={isEdit ? "上游 API Key（留空则保持不变）" : "上游 API Key"}
            type="password"
            value={form.apiKey}
            onChange={update("apiKey")}
            placeholder="sk-..."
            required={!isEdit}
          />
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <Button
              variant="outlined"
              startIcon={
                lookup.loading ? <CircularProgress color="inherit" size={16} /> : <RefreshIcon />
              }
              onClick={() =>
                fetchModels({ force: true }).catch((error) => {
                  setLookup({ loading: false, error: error.message, models: [] });
                  onToast(error.message, "error");
                })
              }
              disabled={lookup.loading || !form.baseUrl.trim() || !form.apiKey.trim()}
            >
              获取模型
            </Button>
            <Typography variant="body2" color="text.secondary">
              填写上游 /v1 Base URL 和 Key 后会自动尝试读取 /v1/models。
            </Typography>
          </Stack>
          {lookup.error ? <Alert severity="warning">{lookup.error}</Alert> : null}
          {lookup.models.length ? (
            <Stack spacing={1}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ xs: "stretch", sm: "center" }}
                justifyContent="space-between"
              >
                <Typography variant="body2" color="text.secondary">
                  已启用 {selectedModels.length} / {lookup.models.length} 个模型
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setModelSelectionTouched(true);
                      setSelectedModels(lookup.models.map((id) => ({ id, name: id, description: "" })));
                    }}
                  >
                    全选
                  </Button>
                  <Button
                    size="small"
                    color="inherit"
                    variant="outlined"
                    onClick={() => {
                      setModelSelectionTouched(true);
                      setSelectedModels([]);
                    }}
                  >
                    清空
                  </Button>
                </Stack>
              </Stack>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                  gap: 1,
                  maxHeight: 300,
                  overflow: "auto",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  p: 1
                }}
              >
                {lookup.models.map((modelId) => {
                  const selected = selectedModels.find((m) => m.id === modelId);
                  const checked = Boolean(selected);

                  return (
                    <Paper
                      key={modelId}
                      variant="outlined"
                      sx={{
                        p: 1,
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto",
                        alignItems: "center",
                        gap: 1,
                        bgcolor: checked ? "rgba(15,118,110,0.07)" : "background.paper",
                        borderColor: checked ? "primary.light" : "divider"
                      }}
                    >
                      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          title={modelId}
                          sx={{
                            fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {modelId}
                        </Typography>
                        {checked ? (
                          <>
                            <TextField
                              size="small"
                              placeholder="显示名称"
                              value={selected.name}
                              onChange={(e) => updateModelName(modelId, e.target.value)}
                              sx={{
                                "& .MuiInputBase-root": {
                                  height: 28,
                                  fontSize: "0.8rem"
                                }
                              }}
                            />
                            <TextField
                              size="small"
                              placeholder="模型说明（给用户看的描述）"
                              value={selected.description}
                              onChange={(e) => updateModelDescription(modelId, e.target.value)}
                              sx={{
                                "& .MuiInputBase-root": {
                                  height: 28,
                                  fontSize: "0.8rem"
                                }
                              }}
                            />
                          </>
                        ) : null}
                      </Stack>
                      <Switch
                        checked={checked}
                        onChange={() => toggleModel(modelId)}
                        inputProps={{ "aria-label": `启用 ${modelId}` }}
                      />
                    </Paper>
                  );
                })}
              </Box>
            </Stack>
          ) : (
            <Alert severity="info">填写 Base URL 和 Key 后，系统会自动获取模型 ID 并在这里分栏展示。</Alert>
          )}

          <Stack spacing={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 780 }}>
              模型映射（自定义模型 ID）
            </Typography>
            <Typography variant="body2" color="text.secondary">
              允许为上游模型设置自定义调用 ID。用户通过自定义 ID 调用时，系统会自动替换为对应的真实模型 ID 转发给上游。
            </Typography>
            {modelMappings.length > 0 ? (
              <Stack spacing={1}>
                {modelMappings.map((mapping, index) => (
                  <Stack key={index} direction="row" spacing={1} alignItems="center">
                    <TextField
                      size="small"
                      label="自定义 ID"
                      placeholder="my-model"
                      value={mapping.customId}
                      onChange={(e) => {
                        const value = e.target.value;
                        setModelMappings((current) =>
                          current.map((m, i) => (i === index ? { ...m, customId: value } : m))
                        );
                      }}
                      sx={{ flex: 1 }}
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                      →
                    </Typography>
                    <Autocomplete
                      size="small"
                      freeSolo
                      options={selectedModels.map((m) => m.id)}
                      value={mapping.upstreamId}
                      onChange={(_, value) => {
                        setModelMappings((current) =>
                          current.map((m, i) => (i === index ? { ...m, upstreamId: value || "" } : m))
                        );
                      }}
                      onInputChange={(_, value) => {
                        setModelMappings((current) =>
                          current.map((m, i) => (i === index ? { ...m, upstreamId: value || "" } : m))
                        );
                      }}
                      renderInput={(params) => (
                        <TextField {...params} label="上游模型 ID" placeholder="选择或输入" sx={{ flex: 1 }} />
                      )}
                    />
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        setModelMappings((current) => current.filter((_, i) => i !== index));
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            ) : null}
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setModelMappings((current) => [...current, { customId: "", upstreamId: "" }])}
              sx={{ width: "fit-content" }}
            >
              添加映射
            </Button>
          </Stack>

          <TextField
            label="故障切换阈值"
            type="number"
            value={form.failoverThreshold}
            onChange={update("failoverThreshold")}
            helperText="连续失败达到该次数后自动切换到下一个供应商（0 表示不启用）"
            inputProps={{ min: 0 }}
            sx={{ maxWidth: 200 }}
          />
          <FormControlLabel
            control={<Switch checked={form.enabled} onChange={update("enabled")} />}
            label="启用"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          onClick={closeDialog}
          disabled={loading}
        >
          取消
        </Button>
        <Button
          type="submit"
          variant="contained"
          startIcon={isEdit ? <EditIcon /> : <AddIcon />}
          disabled={loading || selectedModels.length === 0}
        >
          {isEdit ? "更新" : "保存"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ProviderRow({ provider, afterChange, onConfirm, onEdit, onToast }) {
  const toggle = async () => {
    await request(`/api/admin/providers/${provider.id}`, {
      method: "PUT",
      body: {
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: provider.models,
        enabled: !provider.enabled
      }
    });
    await afterChange(provider.enabled ? "上游 API 已停用" : "上游 API 已启用");
  };

  const remove = () => {
    onConfirm({
      title: "删除上游 API",
      message: `确认删除 ${provider.name}？`,
      confirmText: "删除",
      danger: true,
      action: async () => {
        await request(`/api/admin/providers/${provider.id}`, { method: "DELETE" });
        await afterChange("上游 API 已删除");
      }
    });
  };

  const modelLabels = (provider.models || []).map((m) => {
    if (m && typeof m === "object") return m.name || m.id || "";
    return String(m);
  }).filter(Boolean);

  const mappingLabels = Object.entries(provider.modelMappings || {})
    .map(([customId, upstreamId]) => `${customId}→${upstreamId}`);

  const failures = provider.consecutiveFailures || 0;
  const threshold = typeof provider.failoverThreshold === "number" ? provider.failoverThreshold : 3;
  const failureLabel = failures > 0 && threshold > 0
    ? `连续失败 ${failures}/${threshold} 次`
    : null;

  let failoverChip = null;
  if (!provider.isAvailableForFailover && threshold > 0) {
    failoverChip = { label: "已排除", color: "error" };
  } else if (failures > 0 && threshold > 0) {
    failoverChip = { label: "备用中", color: "warning" };
  } else if (threshold > 0) {
    failoverChip = { label: "正常", color: "success" };
  }

  return (
    <EntityRow
      title={provider.name}
      enabled={provider.enabled}
      failoverChip={failoverChip}
      icon={<ApiIcon />}
      meta={[
        ["Base URL", provider.baseUrl],
        ["API Key", provider.apiKey || "-"],
        ["模型", modelLabels.join(", ") || "-"],
        ...(mappingLabels.length ? [["映射", mappingLabels.join(", ")]] : []),
        ...(failureLabel ? [["故障切换", failureLabel]] : [])
      ]}
      actions={
        <>
          <Button size="small" variant="outlined" onClick={() => toggle().catch((e) => onToast(e.message, "error"))}>
            {provider.enabled ? "停用" : "启用"}
          </Button>
          <Tooltip title="编辑">
            <IconButton onClick={onEdit}>
              <EditIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="删除">
            <IconButton color="error" onClick={remove}>
              <DeleteOutlineIcon />
            </IconButton>
          </Tooltip>
        </>
      }
    />
  );
}

function UserRow({ user, usage, afterChange, onConfirm, onCopy, onToast }) {
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const toggle = async () => {
    await request(`/api/admin/users/${user.id}`, {
      method: "PUT",
      body: { enabled: !user.enabled }
    });
    await afterChange(user.enabled ? "用户已封禁" : "用户已解封");
  };

  const remove = () => {
    onConfirm({
      title: "删除用户账号",
      message: `确认删除 ${user.name}？`,
      confirmText: "删除",
      danger: true,
      action: async () => {
        await request(`/api/admin/users/${user.id}`, { method: "DELETE" });
        await afterChange("用户已删除");
      }
    });
  };

  const resetPassword = async () => {
    if (newPassword.length < 8) {
      onToast("密码至少 8 个字符", "warning");
      return;
    }
    setPasswordLoading(true);
    try {
      await request(`/api/admin/users/${user.id}/password`, {
        method: "PUT",
        body: { password: newPassword }
      });
      setPasswordDialogOpen(false);
      setNewPassword("");
      onToast("密码已重置", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setPasswordLoading(false);
    }
  };

  const apiKeys = getUserApiKeys(user);
  const meta = [
    ["API Key", apiKeys.length ? `${apiKeys.length} 个` : "未创建"],
    ["账号", user.username || "-"],
    ["邮箱", user.email || "-"],
    ["创建时间", formatDate(user.createdAt)]
  ];

  if (usage) {
    meta.push(["用量", `请求 ${usage.requests} 次 / ${usage.totalTokens.toLocaleString()} tokens`]);
  }

  return (
    <>
      <EntityRow
        title={user.name}
        enabled={user.enabled}
        icon={<KeyIcon />}
        meta={meta}
        actions={
          <>
            {apiKeys[0]?.key ? (
              <Tooltip title="复制首个 Key">
                <IconButton size="small" onClick={() => onCopy(apiKeys[0].key)}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title="重置密码">
              <IconButton size="small" onClick={() => setPasswordDialogOpen(true)}>
                <VpnKeyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              size="small"
              variant="outlined"
              color={user.enabled ? "warning" : "success"}
              onClick={() => toggle().catch((error) => onToast(error.message, "error"))}
            >
              {user.enabled ? "封禁" : "解封"}
            </Button>
            <Tooltip title="删除">
              <IconButton size="small" color="error" onClick={remove}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        }
      />
      <Dialog open={passwordDialogOpen} onClose={() => setPasswordDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>重置用户密码</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              为用户 {user.name}（{user.username}）设置新密码。
            </Typography>
            <TextField
              label="新密码"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 8 个字符"
              autoFocus
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasswordDialogOpen(false)} color="inherit">取消</Button>
          <Button
            variant="contained"
            onClick={resetPassword}
            disabled={passwordLoading}
            startIcon={passwordLoading ? <CircularProgress size={16} /> : null}
          >
            确认重置
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function AdminApiKeysSection({ apiKeys, usage, onCopy, onConfirm, afterChange, onToast }) {
  const [name, setName] = useState("");

  const createKey = async () => {
    await request("/api/admin/api-keys", {
      method: "POST",
      body: { name }
    });
    setName("");
    await afterChange("管理员 API Key 已创建");
  };

  const rotateKey = (id) => async () => {
    await request(`/api/admin/api-keys/${id}/rotate`, { method: "POST" });
    await afterChange("API Key 已轮换");
  };

  const toggleKey = (id, enabled) => async () => {
    await request(`/api/admin/api-keys/${id}`, {
      method: "PUT",
      body: { enabled: !enabled }
    });
    await afterChange(enabled ? "API Key 已停用" : "API Key 已启用");
  };

  const deleteKey = (id, keyName) => {
    onConfirm({
      title: "删除管理员 API Key",
      message: `确认删除 ${keyName || "该 Key"}？`,
      confirmText: "删除",
      danger: true,
      action: async () => {
        await request(`/api/admin/api-keys/${id}`, { method: "DELETE" });
        await afterChange("API Key 已删除");
      }
    });
  };

  return (
    <Section
      title="管理员 API Key"
      icon={<AdminPanelSettingsIcon />}
      action={
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            placeholder="Key 名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ width: 180 }}
          />
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => createKey().catch((error) => onToast(error.message, "error"))}>
            创建
          </Button>
        </Stack>
      }
    >
      {apiKeys.length ? (
        <Stack spacing={1.5}>
          {apiKeys.map((apiKey) => {
            const keyUsage = usage?.byApiKey?.find((k) => k.apiKeyId === apiKey.id);
            const meta = [
              ["Key", apiKey.key || apiKey.preview || "-"],
              ["创建时间", formatDate(apiKey.createdAt)]
            ];
            if (keyUsage) {
              meta.push(["用量", `请求 ${keyUsage.requests} 次 / ${keyUsage.totalTokens.toLocaleString()} tokens`]);
            }
            return (
              <EntityRow
                key={apiKey.id}
                title={apiKey.name || "管理员 Key"}
                enabled={apiKey.enabled !== false}
                icon={<KeyIcon />}
                meta={meta}
                actions={
                  <>
                    <Tooltip title="复制 Key">
                      <IconButton onClick={() => onCopy(apiKey.key)} disabled={!apiKey.key}>
                        <ContentCopyIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="轮换 Key">
                      <IconButton onClick={rotateKey(apiKey.id)}>
                        <RotateRightIcon />
                      </IconButton>
                    </Tooltip>
                    <Button size="small" variant="outlined" onClick={() => toggleKey(apiKey.id, apiKey.enabled).catch((error) => onToast(error.message, "error"))}>
                      {apiKey.enabled !== false ? "停用" : "启用"}
                    </Button>
                    <Tooltip title="删除">
                      <IconButton color="error" onClick={() => deleteKey(apiKey.id, apiKey.name)}>
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Tooltip>
                  </>
                }
              />
            );
          })}
        </Stack>
      ) : (
        <EmptyState text="尚未创建管理员 API Key。创建后可用于调用 /v1 和 /responses 端点，拥有全部模型权限。" />
      )}
    </Section>
  );
}

function InvitationCodesSection({ codes, afterChange, onConfirm, onCopy, onToast }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [expiresAtInput, setExpiresAtInput] = useState("");
  const [maxUsesInput, setMaxUsesInput] = useState("");
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [sendForm, setSendForm] = useState({ email: "", codeId: "", customCode: "" });
  const [sendLoading, setSendLoading] = useState(false);

  const createCode = async () => {
    await request("/api/admin/invitation-codes", {
      method: "POST",
      body: {
        code: codeInput,
        note: noteInput,
        expiresAt: expiresAtInput,
        maxUses: maxUsesInput ? Number(maxUsesInput) : 0
      }
    });
    setCodeInput("");
    setNoteInput("");
    setExpiresAtInput("");
    setMaxUsesInput("");
    setCreateOpen(false);
    await afterChange("邀请码已创建");
  };

  const deleteCode = (id, code) => {
    onConfirm({
      title: "删除邀请码",
      message: `确认删除邀请码 ${code}？`,
      confirmText: "删除",
      danger: true,
      action: async () => {
        await request(`/api/admin/invitation-codes/${id}`, { method: "DELETE" });
        await afterChange("邀请码已删除");
      }
    });
  };

  const openSendEmail = (codeId, customCode) => {
    setSendForm({ email: "", codeId: codeId || "", customCode: customCode || "" });
    setSendEmailOpen(true);
  };

  const sendEmail = async () => {
    setSendLoading(true);
    try {
      await request("/api/admin/invitation-codes/send", {
        method: "POST",
        body: sendForm
      });
      setSendEmailOpen(false);
      onToast("邀请邮件已发送", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setSendLoading(false);
    }
  };

  return (
    <>
      <Section
        title="邀请码"
        icon={<VpnKeyIcon />}
        action={
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setCreateOpen(true)}>
            新建邀请码
          </Button>
        }
      >
        {codes.length ? (
          <Stack spacing={1.5}>
            {codes.map((code) => {
              const isExpired = code.expiresAt && new Date(code.expiresAt) < new Date();
              const isMaxed = code.maxUses > 0 && code.usedCount >= code.maxUses;
              const isActive = !isExpired && !isMaxed;
              const usageText = code.maxUses > 0 ? `${code.usedCount || 0} / ${code.maxUses}` : `${code.usedCount || 0} 次`;
              return (
                <Paper
                  key={code.id}
                  variant="outlined"
                  sx={{
                    p: { xs: 1.5, sm: 2 },
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
                    gap: 1.5,
                    alignItems: "center",
                    bgcolor: isActive ? "#fbfcfe" : "action.hover",
                    opacity: isActive ? 1 : 0.85
                  }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                    <Box
                      sx={{
                        width: 38,
                        height: 38,
                        borderRadius: 1,
                        display: "grid",
                        placeItems: "center",
                        bgcolor: isActive ? "rgba(15,118,110,0.1)" : "rgba(120,120,120,0.1)",
                        color: isActive ? "primary.main" : "text.disabled",
                        flexShrink: 0
                      }}
                    >
                      <VpnKeyIcon />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="subtitle1" sx={{ fontWeight: 780, fontFamily: 'Consolas, monospace', overflowWrap: "anywhere" }}>
                          {code.code}
                        </Typography>
                        <Chip
                          size="small"
                          label={isActive ? "有效" : isExpired ? "已过期" : "已达上限"}
                          color={isActive ? "success" : "default"}
                          variant="outlined"
                        />
                        {code.note ? (
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 200 }}>
                            {code.note}
                          </Typography>
                        ) : null}
                      </Stack>
                      <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          已使用 {usageText}
                        </Typography>
                        {code.expiresAt ? (
                          <Typography variant="caption" color={isExpired ? "error" : "text.secondary"}>
                            {isExpired ? "已于 " : ""}{formatDate(code.expiresAt)}{isExpired ? " 过期" : " 过期"}
                          </Typography>
                        ) : null}
                      </Stack>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={{ xs: "flex-start", md: "flex-end" }}>
                    <Tooltip title="复制邀请码">
                      <IconButton size="small" onClick={() => onCopy(code.code)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="发送邀请邮件">
                      <IconButton size="small" onClick={() => openSendEmail(code.id, code.code)}>
                        <MailIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除">
                      <IconButton size="small" color="error" onClick={() => deleteCode(code.id, code.code)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        ) : (
          <EmptyState text="还没有创建邀请码。创建后用户注册时需要输入有效的邀请码。" />
        )}
      </Section>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth PaperProps={{ component: "form", onSubmit: (e) => { e.preventDefault(); createCode().catch((err) => onToast(err.message, "error")); } }}>
        <DialogTitle>新建邀请码</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="自定义邀请码"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="留空则自动生成"
              helperText="4-64 个字符，仅允许字母、数字、下划线和短横线。"
            />
            <TextField
              label="备注"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="例如：团队 A 专用"
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                type="datetime-local"
                label="过期时间"
                InputLabelProps={{ shrink: true }}
                value={expiresAtInput}
                onChange={(e) => setExpiresAtInput(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                type="number"
                label="最大使用次数"
                value={maxUsesInput}
                onChange={(e) => setMaxUsesInput(e.target.value)}
                placeholder="0 表示无限制"
                sx={{ flex: 1 }}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} color="inherit">取消</Button>
          <Button type="submit" variant="contained" startIcon={<AddIcon />}>创建</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={sendEmailOpen} onClose={() => setSendEmailOpen(false)} maxWidth="sm" fullWidth PaperProps={{ component: "form", onSubmit: (e) => { e.preventDefault(); sendEmail().catch((err) => onToast(err.message, "error")); } }}>
        <DialogTitle>发送邀请邮件</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'rgba(15,118,110,0.04)', display: 'flex', alignItems: 'center', gap: 1 }}>
              <VpnKeyIcon fontSize="small" color="action" />
              <Typography variant="body2" sx={{ fontFamily: 'Consolas, monospace', fontWeight: 700 }}>
                {sendForm.customCode}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                将使用此邀请码发送
              </Typography>
            </Paper>
            <TextField
              label="收件人邮箱"
              value={sendForm.email}
              onChange={(e) => setSendForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="user@example.com"
              required
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSendEmailOpen(false)} color="inherit">取消</Button>
          <Button type="submit" variant="contained" disabled={sendLoading} startIcon={sendLoading ? <CircularProgress size={16} /> : <SendIcon />}>
            发送
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function SmtpConfigSection({ config, afterChange, onToast }) {
  const [form, setForm] = useState({
    host: "",
    port: 587,
    secure: false,
    user: "",
    pass: "",
    from: ""
  });
  const [loading, setLoading] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    if (config) {
      setForm({
        host: config.host || "",
        port: config.port || 587,
        secure: config.secure || false,
        user: config.user || "",
        pass: "",
        from: config.from || ""
      });
    }
  }, [config]);

  const update = (field) => (event) => {
    const value = field === "secure" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    setLoading(true);
    try {
      await request("/api/admin/smtp-config", {
        method: "PUT",
        body: form
      });
      await afterChange("SMTP 配置已保存");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const test = async () => {
    if (!testEmail) {
      onToast("请输入测试邮箱地址", "warning");
      return;
    }
    setTestLoading(true);
    try {
      await request("/api/admin/smtp-config/test", {
        method: "POST",
        body: { to: testEmail }
      });
      onToast("测试邮件已发送", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Section title="SMTP 配置" icon={<SettingsIcon />}>
        <Stack spacing={2.5}>
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 780, color: 'text.secondary' }}>
                服务器设置
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="SMTP 服务器" value={form.host} onChange={update("host")} placeholder="smtp.example.com" sx={{ flex: 1 }} />
                <TextField label="端口" type="number" value={form.port} onChange={update("port")} sx={{ width: 140 }} />
              </Stack>
              <FormControlLabel
                control={<Switch checked={form.secure} onChange={update("secure")} />}
                label="使用 SSL/TLS（端口 465 通常需要启用）"
              />
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 780, color: 'text.secondary' }}>
                认证信息
              </Typography>
              <TextField label="用户名" value={form.user} onChange={update("user")} placeholder="your-email@example.com" />
              <TextField
                label="密码"
                type="password"
                value={form.pass}
                onChange={update("pass")}
                placeholder={config.hasPass ? "已设置，留空保持不变" : "SMTP 密码"}
              />
              <TextField
                label="发件人地址"
                value={form.from}
                onChange={update("from")}
                placeholder="noreply@example.com"
                helperText="留空则使用用户名作为发件人。"
              />
            </Stack>
          </Paper>

          <Stack direction="row" spacing={1.5} justifyContent="flex-end">
            <Button
              variant="contained"
              onClick={() => save().catch((e) => onToast(e.message, "error"))}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : null}
            >
              保存配置
            </Button>
          </Stack>
        </Stack>
      </Section>

      <Section title="连接测试" icon={<MailIcon />}>
        <Stack spacing={2} direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "flex-start" }}>
          <TextField
            label="测试邮箱地址"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="your-email@example.com"
            sx={{ flex: 1 }}
          />
          <Button
            variant="outlined"
            onClick={() => test().catch((e) => onToast(e.message, "error"))}
            disabled={testLoading}
            startIcon={testLoading ? <CircularProgress size={16} /> : <MailIcon />}
            sx={{ height: 56, mt: { sm: 0 }, flexShrink: 0 }}
          >
            发送测试邮件
          </Button>
        </Stack>
      </Section>
    </Stack>
  );
}

function EntityRow({ title, enabled, icon, meta, actions, failoverChip }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
        gap: 1.5,
        alignItems: "center",
        bgcolor: "#fbfcfe"
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: 1,
            display: "grid",
            placeItems: "center",
            bgcolor: "rgba(15,118,110,0.1)",
            color: "primary.main",
            flexShrink: 0
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle1" sx={{ fontWeight: 780, overflowWrap: "anywhere" }}>
              {title}
            </Typography>
            <Chip
              size="small"
              label={enabled ? "启用" : "停用"}
              color={enabled ? "success" : "warning"}
              variant="outlined"
            />
            {failoverChip ? (
              <Chip
                size="small"
                label={failoverChip.label}
                color={failoverChip.color}
                variant="outlined"
              />
            ) : null}
          </Stack>
          <Stack spacing={0.3} sx={{ mt: 0.75 }}>
            {meta.map(([label, value]) => (
              <Typography key={label} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                {label}：{value}
              </Typography>
            ))}
          </Stack>
        </Box>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center" justifyContent={{ xs: "flex-start", md: "flex-end" }}>
        {actions}
      </Stack>
    </Paper>
  );
}

function DividerLine() {
  return <Box sx={{ height: 1, bgcolor: "divider", width: "100%" }} />;
}

function PageHeader({ eyebrow, title, description, action }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      alignItems={{ xs: "stretch", sm: "flex-start" }}
      justifyContent="space-between"
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="overline" color="primary" sx={{ fontWeight: 850 }}>
          {eyebrow}
        </Typography>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {description ? (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.7, maxWidth: 720 }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
    </Stack>
  );
}

function Section({ title, icon, action, children }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.75, sm: 2 }, boxShadow: "0 12px 30px rgba(15, 23, 42, 0.05)" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ mb: 1.75 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ color: "primary.main", display: "flex" }}>{icon}</Box>
          <Typography variant="h6">{title}</Typography>
        </Stack>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

function Metric({ icon, label, value }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Stack direction="row" spacing={1.4} alignItems="center">
        <Box
          sx={{
            width: 42,
            height: 42,
            display: "grid",
            placeItems: "center",
            borderRadius: 1,
            bgcolor: "rgba(37,99,235,0.09)",
            color: "secondary.main",
            flexShrink: 0
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h6" noWrap title={String(value)}>
            {value}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

function CodeBlock({ value }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 2,
        overflow: "auto",
        borderRadius: 1,
        bgcolor: "#101820",
        color: "#d1fae5",
        fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.7
      }}
    >
      {value}
    </Box>
  );
}

function EmptyState({ text }) {
  return (
    <Alert severity="info" variant="outlined">
      {text}
    </Alert>
  );
}

function inferVendor(name = "", baseUrl = "") {
  const text = `${name} ${baseUrl}`.toLowerCase();
  if (text.includes("openai")) return "OpenAI";
  if (text.includes("anthropic")) return "Anthropic";
  if (text.includes("deepseek")) return "DeepSeek";
  if (text.includes("gemini") || text.includes("google")) return "Google";
  if (text.includes("azure")) return "Azure";
  if (text.includes("cohere")) return "Cohere";
  if (text.includes("mistral")) return "Mistral";
  if (text.includes("x.ai") || text.includes("grok")) return "xAI";
  return "";
}

function statusColor(status) {
  if (status === "healthy") return "#34d399";
  if (status === "degraded") return "#fbbf24";
  return "#f87171";
}

function statusLabel(status) {
  if (status === "healthy") return "正常";
  if (status === "degraded") return "降级";
  return "不可用";
}

function ProviderHealthCard({ provider }) {
  const vendor = inferVendor(provider.name, provider.baseUrl);
  const primaryModel = provider.models?.[0];
  const modelName = primaryModel?.name || primaryModel?.id || "";
  const history = (provider.healthHistory || []).slice(-60);
  const availability = provider.availability7d ?? 100;
  const label = statusLabel(provider.healthStatus);
  const statusChipColor =
    provider.healthStatus === "healthy"
      ? "success"
      : provider.healthStatus === "degraded"
        ? "warning"
        : "error";
  const availabilityColor =
    availability >= 90 ? "success.main" : availability >= 70 ? "warning.main" : "error.main";

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        bgcolor: "background.paper"
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 780, overflowWrap: "anywhere" }}>
            {provider.name}
          </Typography>
          {vendor ? (
            <Chip label={vendor} size="small" color="primary" variant="outlined" sx={{ fontSize: 11, height: 22, flexShrink: 0 }} />
          ) : null}
        </Stack>
        <Chip label={label} size="small" color={statusChipColor} variant="outlined" sx={{ fontWeight: 700, flexShrink: 0 }} />
      </Stack>

      {provider.isAvailableForFailover === false ? (
        <Chip label="已排除" size="small" color="error" sx={{ fontWeight: 700, alignSelf: "flex-start" }} />
      ) : (provider.consecutiveFailures || 0) > 0 ? (
        <Chip label="备用中" size="small" color="warning" variant="outlined" sx={{ fontWeight: 700, alignSelf: "flex-start" }} />
      ) : null}

      {modelName ? (
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            fontFamily: 'Consolas, monospace',
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
          title={modelName}
        >
          {modelName}
        </Typography>
      ) : null}

      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
        <Paper variant="outlined" sx={{ p: 1.25, bgcolor: "rgba(15,118,110,0.04)" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
            对话延迟
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
            {provider.latency || 0}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.3 }}>
              ms
            </Typography>
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.25, bgcolor: "rgba(37,99,235,0.04)" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
            端点 PING
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
            {provider.ping || 0}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.3 }}>
              ms
            </Typography>
          </Typography>
        </Paper>
      </Box>

      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">
          可用性 · 7 天
        </Typography>
        <Stack direction="row" alignItems="baseline" spacing={0.3}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: availabilityColor }}>
            {availability.toFixed(2)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: availabilityColor }}>
            %
          </Typography>
        </Stack>
      </Stack>

      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">
          故障转移
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: provider.isAvailableForFailover === false ? "error.main" : (provider.consecutiveFailures || 0) > 0 ? "warning.main" : "success.main" }}>
          {provider.isAvailableForFailover === false
            ? `已排除 (${provider.consecutiveFailures}/${provider.failoverThreshold ?? 3})`
            : (provider.consecutiveFailures || 0) > 0
              ? `备用中 (${provider.consecutiveFailures}/${provider.failoverThreshold ?? 3})`
              : "正常"}
        </Typography>
      </Stack>

      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            近 {history.length} 次记录
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {provider.lastHealthCheck
              ? `${Math.max(0, Math.round((Date.now() - new Date(provider.lastHealthCheck).getTime()) / 1000))}s 后刷新`
              : ""}
          </Typography>
        </Stack>
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.4, height: 32 }}>
          {history.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              暂无记录
            </Typography>
          ) : (
            history.map((entry, index) => {
              const hColor =
                entry.status === "ok"
                  ? "success.main"
                  : entry.status === "slow"
                    ? "warning.main"
                    : "error.main";
              const heightPct = Math.min(100, Math.max(12, (entry.latency / 5000) * 100));
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
                      maxWidth: 5,
                      height: `${heightPct}%`,
                      bgcolor: hColor,
                      borderRadius: 0.4,
                      opacity: 0.85,
                      transition: "opacity 0.2s",
                      "&:hover": { opacity: 1 }
                    }}
                  />
                </Tooltip>
              );
            })
          )}
        </Box>
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.25 }}>
          <Typography variant="caption" sx={{ color: "text.disabled", fontSize: 10 }}>
            PAST
          </Typography>
          <Typography variant="caption" sx={{ color: "text.disabled", fontSize: 10 }}>
            NOW
          </Typography>
        </Stack>
      </Box>
    </Paper>
  );
}

function ProviderHealthSection({ providers }) {
  if (!providers || providers.length === 0) return null;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
        gap: 2
      }}
    >
      {providers.map((provider) => (
        <ProviderHealthCard key={provider.id} provider={provider} />
      ))}
    </Box>
  );
}

function ConfirmDialog({ confirm, onClose, onError }) {
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!confirm) return;
    setLoading(true);
    try {
      await confirm.action();
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={Boolean(confirm)} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{confirm?.title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{confirm?.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          取消
        </Button>
        <Button
          variant="contained"
          color={confirm?.danger ? "error" : "primary"}
          onClick={run}
          disabled={loading}
        >
          {confirm?.confirmText || "确认"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CreateApiKeyDialog({ open, models, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    if (loading) return;
    setName("");
    setSelectedModels([]);
    onClose();
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      await onCreate({
        name: name.trim(),
        allowedModels: selectedModels
      });
      setName("");
      setSelectedModels([]);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const modelOptions = models.map((item) => {
    const id = item?.id || item;
    return { id, label: item?.name || id };
  });

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>新增 API Key</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="名称"
            placeholder="例如：开发测试 Key"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
          />
          <FormControl fullWidth size="small">
            <InputLabel id="models-select-label">允许使用的模型（可选）</InputLabel>
            <Select
              labelId="models-select-label"
              multiple
              value={selectedModels}
              onChange={(e) => setSelectedModels(e.target.value)}
              input={<OutlinedInput label="允许使用的模型（可选）" />}
              renderValue={(selected) => (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {selected.map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {modelOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  <Checkbox checked={selectedModels.includes(option.id)} />
                  <ListItemText primary={option.label} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <DialogContentText sx={{ fontSize: 13 }}>
            不选择任何模型则允许使用全部模型。
          </DialogContentText>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          取消
        </Button>
        <Button variant="contained" onClick={handleCreate} disabled={loading}>
          创建
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CreatedKeyDialog({ info, onClose, onCopy }) {
  if (!info) return null;
  return (
    <Dialog open={Boolean(info)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>API Key 已创建</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Alert severity="success">
            Key 已创建并保存，可随时在列表中查看和复制。
          </Alert>
          <TextField
            label="API Key"
            value={info.key}
            fullWidth
            size="small"
            InputProps={{ readOnly: true }}
          />
          {info.allowedModels?.length > 0 ? (
            <Box>
              <Typography variant="caption" color="text.secondary">
                允许使用的模型：
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                {info.allowedModels.map((model) => (
                  <Chip key={model} label={model} size="small" variant="outlined" />
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button
          variant="contained"
          startIcon={<ContentCopyIcon />}
          onClick={() => onCopy(info.key)}
        >
          复制 Key
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AnnouncementsSection({ announcements, afterChange, onConfirm, onToast }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: "", content: "", type: "info" });

  const resetForm = () => setForm({ title: "", content: "", type: "info" });

  const createAnnouncement = async () => {
    await request("/api/admin/announcements", {
      method: "POST",
      body: form
    });
    resetForm();
    setCreateOpen(false);
    await afterChange("公告已发布");
  };

  const updateAnnouncement = async () => {
    if (!editing) return;
    await request(`/api/admin/announcements/${editing.id}`, {
      method: "PUT",
      body: form
    });
    setEditOpen(false);
    setEditing(null);
    await afterChange("公告已更新");
  };

  const deleteAnnouncement = (id, title) => {
    onConfirm({
      title: "删除公告",
      message: `确认删除公告 "${title}"？`,
      confirmText: "删除",
      danger: true,
      action: async () => {
        await request(`/api/admin/announcements/${id}`, { method: "DELETE" });
        await afterChange("公告已删除");
      }
    });
  };

  const toggleEnabled = async (item) => {
    try {
      await request(`/api/admin/announcements/${item.id}`, {
        method: "PUT",
        body: { enabled: !item.enabled }
      });
      await afterChange(item.enabled ? "公告已停用" : "公告已启用");
    } catch (error) {
      onToast(error.message, "error");
    }
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({ title: item.title, content: item.content, type: item.type || "info" });
    setEditOpen(true);
  };

  const typeColor = (type) => {
    if (type === "warning") return "warning";
    if (type === "error") return "error";
    if (type === "success") return "success";
    return "info";
  };

  const typeLabel = (type) => {
    if (type === "warning") return "警告";
    if (type === "error") return "错误";
    if (type === "success") return "成功";
    return "信息";
  };

  return (
    <>
      <Section
        title="系统公告"
        icon={<CampaignOutlinedIcon />}
        action={
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => { resetForm(); setCreateOpen(true); }}>
            发布公告
          </Button>
        }
      >
        {announcements.length ? (
          <Stack spacing={1.5}>
            {announcements.map((item) => (
              <Paper
                key={item.id}
                variant="outlined"
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
                  gap: 1.5,
                  alignItems: "center",
                  bgcolor: item.enabled !== false ? "#fbfcfe" : "action.hover",
                  opacity: item.enabled !== false ? 1 : 0.85
                }}
              >
                <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="subtitle1" sx={{ fontWeight: 780 }}>
                      {item.title}
                    </Typography>
                    <Chip size="small" label={typeLabel(item.type)} color={typeColor(item.type)} variant="outlined" />
                    <Chip
                      size="small"
                      label={item.enabled !== false ? "已启用" : "已停用"}
                      color={item.enabled !== false ? "success" : "default"}
                      variant="outlined"
                    />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                    {item.content}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    更新于 {formatDate(item.updatedAt || item.createdAt)}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={{ xs: "flex-start", md: "flex-end" }}>
                  <Tooltip title={item.enabled !== false ? "停用" : "启用"}>
                    <IconButton size="small" onClick={() => toggleEnabled(item)}>
                      {item.enabled !== false ? <CheckCircleIcon fontSize="small" color="success" /> : <CheckCircleIcon fontSize="small" color="disabled" />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="编辑">
                    <IconButton size="small" onClick={() => openEdit(item)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="删除">
                    <IconButton size="small" color="error" onClick={() => deleteAnnouncement(item.id, item.title)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <EmptyState text="还没有发布公告。发布公告后，用户端将以弹窗卡片的形式展示。" />
        )}
      </Section>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth PaperProps={{ component: "form", onSubmit: (e) => { e.preventDefault(); createAnnouncement().catch((err) => onToast(err.message, "error")); } }}>
        <DialogTitle>发布公告</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="标题"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="公告标题"
              required
              autoFocus
            />
            <TextField
              label="内容"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="公告内容"
              multiline
              rows={4}
              required
            />
            <FormControl fullWidth>
              <InputLabel id="ann-type-label">类型</InputLabel>
              <Select
                labelId="ann-type-label"
                value={form.type}
                label="类型"
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                <MenuItem value="info">信息</MenuItem>
                <MenuItem value="warning">警告</MenuItem>
                <MenuItem value="success">成功</MenuItem>
                <MenuItem value="error">错误</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} color="inherit">取消</Button>
          <Button type="submit" variant="contained" startIcon={<AddIcon />}>发布</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editOpen} onClose={() => { setEditOpen(false); setEditing(null); }} maxWidth="sm" fullWidth PaperProps={{ component: "form", onSubmit: (e) => { e.preventDefault(); updateAnnouncement().catch((err) => onToast(err.message, "error")); } }}>
        <DialogTitle>编辑公告</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="标题"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
            <TextField
              label="内容"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              multiline
              rows={4}
              required
            />
            <FormControl fullWidth>
              <InputLabel id="ann-edit-type-label">类型</InputLabel>
              <Select
                labelId="ann-edit-type-label"
                value={form.type}
                label="类型"
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                <MenuItem value="info">信息</MenuItem>
                <MenuItem value="warning">警告</MenuItem>
                <MenuItem value="success">成功</MenuItem>
                <MenuItem value="error">错误</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditOpen(false); setEditing(null); }} color="inherit">取消</Button>
          <Button type="submit" variant="contained" startIcon={<EditIcon />}>更新</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function AnnouncementDialog({ announcement, onDismiss }) {
  if (!announcement) return null;

  const severityMap = {
    info: "info",
    warning: "warning",
    success: "success",
    error: "error"
  };
  const severity = severityMap[announcement.type] || "info";

  return (
    <Dialog open={Boolean(announcement)} onClose={onDismiss} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <CampaignOutlinedIcon color={severity} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 780 }}>
            {announcement.title}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Alert severity={severity} variant="outlined" sx={{ whiteSpace: "pre-wrap" }}>
          {announcement.content}
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDismiss} variant="contained">知道了</Button>
      </DialogActions>
    </Dialog>
  );
}

function getInitialRoute() {
  const route = window.location.hash.replace("#", "");
  return ["home", "admin", "login", "register", "portal"].includes(route) ? route : "home";
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function getUserApiKeys(user) {
  if (Array.isArray(user?.apiKeys) && user.apiKeys.length) return user.apiKeys;
  if (!user?.apiKey) return [];
  return [
    {
      id: "primary",
      name: "默认 Key",
      key: user.apiKey,
      preview: user.apiKey,
      enabled: true,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastUsedAt: ""
    }
  ];
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDuration(value) {
  const ms = Number(value || 0);
  if (!ms) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatUserName(item) {
  const name = item?.userName || item?.name || "";
  const username = item?.username || "";
  if (name && username && name !== username) return `${name} (${username})`;
  return name || username || item?.userId || "-";
}

function cacheHitText(request) {
  const cachedTokens = Number(request?.cachedTokens || 0);
  const cacheMissTokens = Number(request?.cacheMissTokens || 0);
  if (!cachedTokens && !cacheMissTokens) return "0";
  if (!cacheMissTokens) return formatNumber(cachedTokens);

  const hitRate = Math.round((cachedTokens / (cachedTokens + cacheMissTokens)) * 100);
  return `${formatNumber(cachedTokens)} (${hitRate}%)`;
}

function requestStatusColor(request) {
  const status = Number(request?.status || 0);
  if (request?.ok || (status >= 200 && status < 300)) return "success";
  if (status >= 400 && status < 500) return "warning";
  return "error";
}

const inlineCodeSx = {
  display: "inline",
  px: 0.5,
  py: 0.15,
  mx: 0.25,
  borderRadius: 0.75,
  bgcolor: "rgba(15,23,42,0.06)",
  color: "text.primary",
  fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
  fontSize: "0.92em",
  overflowWrap: "anywhere"
};

createRoot(document.getElementById("root")).render(<App />);
