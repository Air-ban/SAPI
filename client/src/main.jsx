import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
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
  Toolbar,
  Tooltip,
  Typography,
  createTheme,
  useMediaQuery
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import ApiIcon from "@mui/icons-material/Api";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DnsIcon from "@mui/icons-material/Dns";
import KeyIcon from "@mui/icons-material/Key";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import RefreshIcon from "@mui/icons-material/Refresh";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import RotateRightIcon from "@mui/icons-material/RotateRight";

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
}

function App() {
  const [route, setRoute] = useState(getInitialRoute);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [health, setHealth] = useState("checking");
  const [selectedKey, setSelectedKey] = useState("");
  const [adminToken, setAdminToken] = useState(
    localStorage.getItem(ADMIN_TOKEN_KEY) || ""
  );
  const [userToken, setUserToken] = useState(localStorage.getItem(USER_TOKEN_KEY) || "");
  const [userSession, setUserSession] = useState(null);
  const [adminState, setAdminState] = useState(null);
  const [toast, setToast] = useState({ open: false, message: "", severity: "success" });
  const [confirm, setConfirm] = useState(null);
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

  const loadAdminState = useCallback(async () => {
    const state = await request("/api/admin/state");
    setAdminState(state);
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
  }, [checkHealth]);

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
    }
  }, [loadUserSession, showToast, userLogout, userToken]);

  const navigate = (nextRoute) => {
    window.location.hash = `#${nextRoute}`;
    setRoute(nextRoute);
    setMobileOpen(false);
  };

  const login = async ({ username, password }) => {
    const data = await request("/api/auth/login", {
      method: "POST",
      admin: false,
      body: { username, password }
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

  const userRegister = async ({ name, username, password }) => {
    const data = await request("/api/auth/register", {
      method: "POST",
      admin: false,
      body: { name, username, password }
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

  const createUserApiKey = async () => {
    const data = await request("/api/user/api-key", {
      method: "POST",
      admin: false,
      token: userToken
    });
    setUserSession((current) => ({ ...(current || {}), user: data.user }));
    setSelectedKey(data.user.apiKey || "");
    showToast("API Key 已创建");
  };

  const rotateUserApiKey = async () => {
    const data = await request("/api/user/api-key/rotate", {
      method: "POST",
      admin: false,
      token: userToken
    });
    setUserSession((current) => ({ ...(current || {}), user: data.user }));
    setSelectedKey(data.user.apiKey || "");
    showToast("API Key 已轮换");
  };

  const copyText = async (text) => {
    await navigator.clipboard.writeText(text);
    showToast("已复制");
  };

  const afterAdminChange = async (message) => {
    await loadAdminState();
    showToast(message);
  };

  const drawer = (
    <Sidebar
      route={route}
      health={health}
      onNavigate={navigate}
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
                config={userSession?.config}
                selectedKey={selectedKey}
                user={userSession?.user || null}
                onNavigate={navigate}
                onUserLogout={() => {
                  userLogout();
                  showToast("已退出");
                }}
                onCreateApiKey={() =>
                  createUserApiKey().catch((error) => showToast(error.message, "error"))
                }
                onRotateApiKey={() =>
                  setConfirm({
                    title: "轮换 API Key",
                    message: "旧 Key 会立即失效。继续？",
                    confirmText: "轮换",
                    action: rotateUserApiKey
                  })
                }
                onRefresh={() =>
                  loadUserSession()
                    .then(() => showToast("已刷新"))
                    .catch((error) => showToast(error.message, "error"))
                }
                onCopy={copyText}
              />
            ) : (
              <AdminView
                state={adminState}
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
        component="main"
        sx={{
          maxWidth: 980,
          mx: "auto",
          px: { xs: 2, sm: 3 },
          py: { xs: 6, md: 9 }
        }}
      >
        <Stack spacing={3.5}>
          <Stack spacing={1.4} sx={{ maxWidth: 720 }}>
            <Chip
              label={statusText}
              color={health === "ok" ? "success" : health === "fail" ? "error" : "warning"}
              variant="outlined"
              sx={{ width: "fit-content", fontWeight: 760 }}
            />
            <Typography variant="h3" component="h1" sx={{ fontWeight: 820, letterSpacing: 0 }}>
              SAPI 是一个 LLM API 中转站
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ lineHeight: 1.7, fontWeight: 420 }}>
              管理员统一配置上游模型供应商，注册用户登录后自行创建 API Key，
              再通过 SAPI 调用 OpenAI 兼容接口。
            </Typography>
          </Stack>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
              gap: 2
            }}
          >
            <IntroItem icon={<AdminPanelSettingsIcon />} title="后台集中管理" text="管理员维护上游供应商、密钥和开放模型。" />
            <IntroItem icon={<KeyIcon />} title="用户自助密钥" text="用户注册登录后，在控制台创建和轮换自己的 API Key。" />
            <IntroItem icon={<ApiIcon />} title="兼容调用方式" text="面向用户提供统一的 OpenAI 兼容转发入口。" />
          </Box>

          {!user && !admin ? (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.4}>
              <Button size="large" variant="contained" startIcon={<LoginIcon />} onClick={() => onNavigate("login")}>
                登录使用
              </Button>
              <Button size="large" variant="outlined" startIcon={<PersonAddIcon />} onClick={() => onNavigate("register")}>
                注册账号
              </Button>
            </Stack>
          ) : null}
        </Stack>
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

function AuthPage({ mode, onLogin, onRegister, onNavigate, onToast }) {
  const isRegister = mode === "register";
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    confirmPassword: ""
  });
  const [loading, setLoading] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const submit = async (event) => {
    event.preventDefault();

    if (isRegister && form.password !== form.confirmPassword) {
      onToast("两次输入的密码不一致", "warning");
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        await onRegister({
          name: form.name,
          username: form.username,
          password: form.password
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
                  : "管理员账号会进入后台，普通账号会进入用户控制台。"}
              </Typography>
            </Box>
          </Stack>

          <Box component="form" onSubmit={submit}>
            <Stack spacing={1.5}>
              {isRegister ? (
                <TextField
                  label="显示名称"
                  value={form.name}
                  onChange={update("name")}
                  placeholder="团队或成员名称"
                />
              ) : null}
              <TextField
                label="用户名"
                value={form.username}
                onChange={update("username")}
                autoComplete="username"
                placeholder="name@example.com"
                required
              />
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
              <Button
                type="submit"
                variant="contained"
                size="large"
                startIcon={isRegister ? <PersonAddIcon /> : <LoginIcon />}
                disabled={loading}
              >
                {isRegister ? "注册" : "登录"}
              </Button>
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
  );
}

function Sidebar({ route, health, user, admin, onNavigate, onUserLogout, onRefresh }) {
  const healthMeta = {
    ok: { label: "服务正常", color: "#22c55e" },
    fail: { label: "服务异常", color: "#ef4444" },
    checking: { label: "检查中", color: "#eab308" }
  }[health];

  return (
    <Stack sx={{ height: "100%", p: 2.25 }} spacing={3}>
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
            primary="用户控制台"
            secondary="端点、模型、调用示例"
            onClick={() => onNavigate("portal")}
          />
        ) : null}
        {admin ? (
          <NavItem
            active={route === "admin"}
            icon={<AdminPanelSettingsIcon />}
            primary="管理后台"
            secondary="上游 API 与用户 Key"
            onClick={() => onNavigate("admin")}
          />
        ) : null}
      </List>

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
  config,
  selectedKey,
  user,
  onNavigate,
  onUserLogout,
  onCreateApiKey,
  onRotateApiKey,
  onRefresh,
  onCopy
}) {
  const effectiveConfig = config || {
    baseUrl: window.location.origin,
    endpoints: [],
    models: []
  };
  const displayKey = user?.apiKey || selectedKey || "sk-sapi-REPLACE_WITH_YOUR_KEY";
  const model = effectiveConfig.models[0] || "gpt-4o-mini";
  const curlExample = [
    `curl ${effectiveConfig.baseUrl}/v1/chat/completions \\`,
    `  -H "Authorization: Bearer ${displayKey}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"hello"}]}'`
  ].join("\n");

  return (
    <Stack spacing={2.5}>
      <PageHeader
        eyebrow="用户前台"
        title="可调用 API"
        description="你的 SAPI API Key、可用模型、端点和调用示例。"
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

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 390px" },
          gap: 2
        }}
      >
        <Section title="我的 API Key" icon={<KeyIcon />}>
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
              {user.apiKey ? (
                <>
                  <Box
                    component="code"
                    sx={{
                      ...inlineCodeSx,
                      display: "block",
                      p: 1.3,
                      mx: 0,
                      overflowWrap: "anywhere"
                    }}
                  >
                    {user.apiKey}
                  </Box>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <Button
                      startIcon={<ContentCopyIcon />}
                      variant="contained"
                      onClick={() => onCopy(user.apiKey)}
                    >
                      复制 Key
                    </Button>
                    <Button
                      startIcon={<RotateRightIcon />}
                      variant="outlined"
                      onClick={onRotateApiKey}
                    >
                      轮换 Key
                    </Button>
                  </Stack>
                </>
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

        <Section title="可用模型" icon={<ApiIcon />}>
          {effectiveConfig.models.length ? (
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {effectiveConfig.models.map((item) => (
                <Chip key={item} label={item} color="primary" variant="outlined" />
              ))}
            </Stack>
          ) : (
            <EmptyState text="管理员还没有配置可用模型。" />
          )}
        </Section>
      </Box>

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
    </Stack>
  );
}

function AdminView({
  state,
  onLogout,
  onCopy,
  onRefresh,
  onConfirm,
  afterChange,
  onToast
}) {
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);

  const providers = state?.providers || [];
  const users = state?.users || [];

  return (
    <Stack spacing={2.5}>
      <PageHeader
        eyebrow="管理后台"
        title="上游 API 与用户 Key"
        description="集中配置供应商密钥，查看用户自助创建的 SAPI Key，并控制访问状态。"
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
              />
            ))}
          </Stack>
        ) : (
          <EmptyState text="还没有配置上游 API。添加后用户前台会显示对应模型。" />
        )}
      </Section>

      <ProviderDialog
        open={providerDialogOpen}
        onClose={() => setProviderDialogOpen(false)}
        afterChange={afterChange}
        onToast={onToast}
      />

      <Section title="用户账号" icon={<KeyIcon />}>
        {users.length ? (
          <Stack spacing={1.5}>
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                afterChange={afterChange}
                onConfirm={onConfirm}
                onCopy={onCopy}
                onToast={onToast}
              />
            ))}
          </Stack>
        ) : (
          <EmptyState text="还没有注册用户。" />
        )}
      </Section>
    </Stack>
  );
}

function ProviderDialog({ open, onClose, afterChange, onToast }) {
  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    enabled: true
  });
  const [selectedModels, setSelectedModels] = useState([]);
  const [modelSelectionTouched, setModelSelectionTouched] = useState(false);
  const [lookup, setLookup] = useState({ loading: false, error: "", models: [] });
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setForm({ name: "", baseUrl: "", apiKey: "", enabled: true });
    setSelectedModels([]);
    setModelSelectionTouched(false);
    setLookup({ loading: false, error: "", models: [] });
  }, []);

  const closeDialog = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const update = (field) => (event) => {
    const value = field === "enabled" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toggleModel = (model) => {
    setModelSelectionTouched(true);
    setSelectedModels((current) =>
      current.includes(model) ? current.filter((item) => item !== model) : [...current, model]
    );
  };

  const fetchModels = useCallback(
    async ({ force = false, signal } = {}) => {
      const baseUrl = form.baseUrl.trim();
      const apiKey = form.apiKey.trim();

      if (!baseUrl || !apiKey) {
        setLookup({ loading: false, error: "", models: [] });
        setSelectedModels([]);
        setModelSelectionTouched(false);
        return;
      }

      try {
        new URL(baseUrl);
      } catch {
        setLookup({ loading: false, error: "", models: [] });
        setSelectedModels([]);
        setModelSelectionTouched(false);
        return;
      }

      setLookup((current) => ({ ...current, loading: true, error: "" }));
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
          return current.filter((model) => models.includes(model));
        }
        return models;
      });
      if (force) setModelSelectionTouched(false);
      if (force && !models.length) {
        onToast("上游没有返回模型 ID", "warning");
      }
    },
    [form.apiKey, form.baseUrl, modelSelectionTouched, onToast]
  );

  useEffect(() => {
    if (!open) return undefined;

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
  }, [fetchModels, open]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      await request("/api/admin/providers", {
        method: "POST",
        body: {
          ...form,
          models: selectedModels
        }
      });
      closeDialog();
      await afterChange("上游 API 已保存");
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
      <DialogTitle>添加上游供应商</DialogTitle>
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
            label="上游 API Key"
            type="password"
            value={form.apiKey}
            onChange={update("apiKey")}
            placeholder="sk-..."
            required
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
              填写 Base URL 和 Key 后会自动尝试读取 /v1/models。
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
                      setSelectedModels(lookup.models);
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
                {lookup.models.map((model) => {
                  const checked = selectedModels.includes(model);

                  return (
                    <Paper
                      key={model}
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
                      <Typography
                        variant="body2"
                        title={model}
                        sx={{
                          fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {model}
                      </Typography>
                      <Switch
                        checked={checked}
                        onChange={() => toggleModel(model)}
                        inputProps={{ "aria-label": `启用 ${model}` }}
                      />
                    </Paper>
                  );
                })}
              </Box>
            </Stack>
          ) : (
            <Alert severity="info">填写 Base URL 和 Key 后，系统会自动获取模型 ID 并在这里分栏展示。</Alert>
          )}
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
          startIcon={<AddIcon />}
          disabled={loading || selectedModels.length === 0}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ProviderRow({ provider, afterChange, onConfirm, onToast }) {
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

  return (
    <EntityRow
      title={provider.name}
      enabled={provider.enabled}
      icon={<ApiIcon />}
      meta={[
        ["Base URL", provider.baseUrl],
        ["API Key", provider.apiKey || "-"],
        ["模型", provider.models?.join(", ") || "-"]
      ]}
      actions={
        <>
          <Button size="small" variant="outlined" onClick={() => toggle().catch((e) => onToast(e.message, "error"))}>
            {provider.enabled ? "停用" : "启用"}
          </Button>
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

function UserRow({ user, afterChange, onConfirm, onCopy, onToast }) {
  const toggle = async () => {
    await request(`/api/admin/users/${user.id}`, {
      method: "PUT",
      body: { enabled: !user.enabled }
    });
    await afterChange(user.enabled ? "用户 Key 已停用" : "用户 Key 已启用");
  };

  const remove = () => {
    onConfirm({
      title: "删除用户账号",
      message: `确认删除 ${user.name}？`,
      confirmText: "删除",
      danger: true,
      action: async () => {
        await request(`/api/admin/users/${user.id}`, { method: "DELETE" });
        await afterChange("用户 Key 已删除");
      }
    });
  };

  return (
    <EntityRow
      title={user.name}
      enabled={user.enabled}
      icon={<KeyIcon />}
      meta={[
        ["API Key", user.apiKey || "未创建"],
        ["账号", user.username || "-"],
        ["创建时间", formatDate(user.createdAt)]
      ]}
      actions={
        <>
          {user.apiKey ? (
            <Tooltip title="复制 Key">
              <IconButton onClick={() => onCopy(user.apiKey)}>
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
          ) : null}
          <Button size="small" variant="outlined" onClick={() => toggle().catch((error) => onToast(error.message, "error"))}>
            {user.enabled ? "停用" : "启用"}
          </Button>
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

function EntityRow({ title, enabled, icon, meta, actions }) {
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
