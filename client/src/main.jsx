import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  AppBar,
  Box,
  Button,
  CssBaseline,
  Drawer,
  IconButton,
  Snackbar,
  ThemeProvider,
  Toolbar,
  Typography,
  useMediaQuery
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import LoginIcon from "@mui/icons-material/Login";
import PersonAddIcon from "@mui/icons-material/PersonAdd";

import theme from "./theme";
import { DRAWER_WIDTH, ADMIN_TOKEN_KEY, USER_TOKEN_KEY } from "./constants";
import { request } from "./utils/api";
import { getInitialRoute } from "./utils/helpers";
import { setupMarked } from "./utils/markedConfig";

import { Sidebar } from "./components/Sidebar";
import { LoadingPage } from "./components/LoadingPage";
import { MaintenanceBanner } from "./components/MaintenanceBanner";
import { SiteBanner } from "./components/SiteBanner";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CreateApiKeyDialog } from "./components/CreateApiKeyDialog";
import { CreatedKeyDialog } from "./components/CreatedKeyDialog";

import { HomePage, RequireAccountPage } from "./pages/HomePage";
import { AuthPage } from "./pages/AuthPage";
import { PortalView } from "./pages/PortalView";
import { AdminView } from "./admin/AdminView";
import { AnnouncementDialog } from "./admin/AnnouncementDialog";

setupMarked();

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
  const [banner, setBanner] = useState(null);
  const [maintenance, setMaintenance] = useState({ maintenanceMode: false, maintenanceEndTime: "" });
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

  const loadBanner = useCallback(async () => {
    try {
      const data = await request("/api/banner", { admin: false });
      setBanner(data.content ? data : null);
    } catch {
      setBanner(null);
    }
  }, []);

  const loadMaintenance = useCallback(async () => {
    try {
      const data = await request("/api/maintenance", { admin: false });
      setMaintenance(data);
    } catch {
      setMaintenance({ maintenanceMode: false, maintenanceEndTime: "" });
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
    loadBanner();
    loadMaintenance();
  }, [checkHealth, loadPublicConfig, loadAnnouncements, loadBanner, loadMaintenance]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      await loadProviderHealth();
      if (!cancelled) setTimeout(poll, 30000);
    };
    loadProviderHealth();
    setTimeout(poll, 30000);
    return () => { cancelled = true; };
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
    if (route === "portal" || route === "home") {
      loadMaintenance();
    }
  }, [route, loadMaintenance]);

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

  const updateUserSettings = async (body) => {
    const data = await request("/api/user/settings", {
      method: "PUT",
      admin: false,
      token: userToken,
      body
    });
    setUserSession((current) => ({ ...(current || {}), user: data.user }));
    showToast("设置已保存");
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
        if (page === "swagger") {
          window.open("/swagger", "_blank");
          setMobileOpen(false);
          return;
        }
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
          announcements={announcements}
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
              HanGuan's SuperAPI
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
            {maintenance.maintenanceMode ? (
              <MaintenanceBanner maintenance={maintenance} />
            ) : null}
            {(route === "portal" && banner) ? (
              <SiteBanner banner={banner} />
            ) : null}
            {route === "portal" ? (
              <PortalView
                page={portalPage}
                config={userSession?.config}
                selectedKey={selectedKey}
                user={userSession?.user || null}
                usage={userUsage}
                providerHealth={providerHealth}
                announcements={announcements}
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
                onUpdateSettings={(body) =>
                  updateUserSettings(body).catch((error) => showToast(error.message, "error"))
                }
                onToast={showToast}
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

createRoot(document.getElementById("root")).render(<App />);
