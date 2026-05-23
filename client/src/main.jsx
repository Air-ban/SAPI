import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  AppBar,
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
  }, [checkHealth]);

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
  const adminPages = [
    { id: "overview", icon: <AnalyticsIcon />, primary: "概览", secondary: "用量、供应商、用户摘要" },
    { id: "usage", icon: <BarChartIcon />, primary: "请求与用量", secondary: "全局统计和明细" },
    { id: "providers", icon: <ApiIcon />, primary: "上游供应商", secondary: "API、模型和密钥" },
    { id: "users", icon: <KeyIcon />, primary: "用户账号", secondary: "用户 Key 与权限" }
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
        <Typography variant="caption" sx={{ px: 1, color: "#7f91a4", fontWeight: 800, textTransform: "uppercase" }}>
          工作区
        </Typography>
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
        <Stack spacing={1.25}>
          <Typography variant="caption" sx={{ px: 1, color: "#7f91a4", fontWeight: 800, textTransform: "uppercase" }}>
            管理后台
          </Typography>
          <List disablePadding sx={{ display: "grid", gap: 1 }}>
            {adminPages.map((item) => (
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
                return <Chip key={id} label={name} color="primary" variant="outlined" />;
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

function ApiKeyCard({ apiKey, usage, onCopy, onRotate, onToggle }) {
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
                          <Typography variant="body2" sx={{ fontFamily: 'Consolas, monospace' }} noWrap title={request.model}>
                            {request.model || "unknown"}
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

function AdminView({
  page = "overview",
  state,
  providerHealth,
  onLogout,
  onCopy,
  onRefresh,
  onConfirm,
  afterChange,
  onToast
}) {
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);

  const providers = state?.providers || [];
  const users = state?.users || [];
  const usage = state?.usage;
  const currentPage = ["overview", "usage", "providers", "users"].includes(page)
    ? page
    : "overview";
  const pageMeta = {
    overview: { title: "上游 API 与用户 Key", description: "供应商、用户和用量摘要。" },
    usage: { title: "请求与用量", description: "查看全局 Token 统计和最近请求。" },
    providers: { title: "上游供应商", description: "配置模型来源、密钥和启用状态。" },
    users: { title: "用户账号", description: "管理用户 Key 和访问状态。" }
  }[currentPage] || {
    title: "上游 API 与用户 Key",
    description: "供应商、用户和用量摘要。"
  };

  return (
    <Stack spacing={2.5}>
      <PageHeader
        eyebrow="管理后台"
        title={pageMeta.title}
        description={pageMeta.description}
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

  useEffect(() => {
    if (!open) return;
    if (provider) {
      setForm({
        name: provider.name || "",
        baseUrl: provider.baseUrl || "",
        apiKey: "",
        enabled: provider.enabled !== false
      });
      const normalized = (provider.models || []).map((m) => {
        if (m && typeof m === "object") return { id: m.id || "", name: m.name || m.id || "" };
        return { id: String(m), name: String(m) };
      }).filter((m) => m.id);
      setSelectedModels(normalized);
      setModelSelectionTouched(false);
      setLookup({ loading: false, error: "", models: normalized.map((m) => m.id) });
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
      return [...current, { id: modelId, name: modelId }];
    });
  };

  const updateModelName = (modelId, name) => {
    setSelectedModels((current) =>
      current.map((m) => (m.id === modelId ? { ...m, name: name || m.id } : m))
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
            return existing || { id, name: id };
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
      const body = { ...form, models: selectedModels };
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
                      setSelectedModels(lookup.models.map((id) => ({ id, name: id })));
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

  return (
    <EntityRow
      title={provider.name}
      enabled={provider.enabled}
      icon={<ApiIcon />}
      meta={[
        ["Base URL", provider.baseUrl],
        ["API Key", provider.apiKey || "-"],
        ["模型", modelLabels.join(", ") || "-"]
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

  const apiKeys = getUserApiKeys(user);
  const meta = [
    ["API Key", apiKeys.length ? `${apiKeys.length} 个` : "未创建"],
    ["账号", user.username || "-"],
    ["创建时间", formatDate(user.createdAt)]
  ];

  if (usage) {
    meta.push(["用量", `请求 ${usage.requests} 次 / ${usage.totalTokens.toLocaleString()} tokens`]);
  }

  return (
    <EntityRow
      title={user.name}
      enabled={user.enabled}
      icon={<KeyIcon />}
      meta={meta}
      actions={
        <>
          {apiKeys[0]?.key ? (
            <Tooltip title="复制首个 Key">
              <IconButton onClick={() => onCopy(apiKeys[0].key)}>
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
          <Alert severity="warning">
            请立即复制并妥善保存 Key，关闭后无法再次查看完整 Key。
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
