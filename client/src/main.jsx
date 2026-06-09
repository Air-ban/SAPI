import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useMemo } from "react";
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

import { createAppTheme } from "./theme";
import { DRAWER_WIDTH, ADMIN_TOKEN_KEY, USER_TOKEN_KEY } from "./constants";
import { request } from "./utils/api";
import { getInitialRoute } from "./utils/helpers";
import { setupMarked } from "./utils/markedConfig";
import {
  decodeCreationOptions,
  decodeRequestOptions,
  encodeLoginCredential,
  encodeRegistrationCredential,
  passkeySupported
} from "./utils/passkey";

import { Sidebar } from "./components/Sidebar";
import { LoadingPage } from "./components/LoadingPage";
import { MaintenanceBanner } from "./components/MaintenanceBanner";
import { SiteBanner } from "./components/SiteBanner";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CreateApiKeyDialog } from "./components/CreateApiKeyDialog";
import { CreatedKeyDialog } from "./components/CreatedKeyDialog";
import { ThemeModeToggle } from "./components/ThemeModeToggle";
import { ModelAvailabilityDashboard } from "./components/ModelAvailabilityDashboard";

import { HomePage, RequireAccountPage } from "./pages/HomePage";
import { AuthPage } from "./pages/AuthPage";
import { PortalView } from "./pages/PortalView";
import { AdminView } from "./admin/AdminView";
import { AnnouncementDialog } from "./admin/AnnouncementDialog";

setupMarked();

const GITHUB_AUTH_ERROR_MESSAGES = {
  github_follow_check_failed: "暂时无法校验 GitHub 关注状态，请稍后再试",
  github_account_conflict: "该邮箱已绑定其他 GitHub 账号",
  github_not_configured: "GitHub 登录暂未配置",
  invalid_state: "GitHub 登录状态已过期，请重试",
  missing_code: "GitHub 登录授权失败，请重试",
  token_exchange_failed: "GitHub 授权换取令牌失败，请重试",
  profile_fetch_failed: "无法读取 GitHub 账号信息，请重试",
  invalid_profile: "GitHub 账号信息不完整",
  terms_required: "请先同意用户协议和隐私政策",
  user_disabled: "账号已被禁用"
};

function githubAuthErrorMessage(code, followTarget = "") {
  if (code === "github_follow_required") {
    return followTarget
      ? `请先关注 @${followTarget} 后再使用 GitHub 注册`
      : "请先关注指定 GitHub 账号后再使用 GitHub 注册";
  }
  return GITHUB_AUTH_ERROR_MESSAGES[code] || code || "GitHub 登录失败";
}

function getInitialThemeMode() {
  const saved = localStorage.getItem("sapiThemeMode");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function makeSessionError(message, code = "session_mismatch") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isAdminAuthFailure(error) {
  return error?.status === 401 || error?.status === 403 || error?.code === "session_mismatch";
}

function assertSessionMatchesToken(token, session, expectedRole, expectedSub = "") {
  const local = decodeJwtPayload(token);
  if (!local || local.role !== expectedRole) {
    throw makeSessionError("登录状态无效，请重新登录");
  }
  if (!session) {
    throw makeSessionError("登录状态暂时无法恢复，请刷新重试", "session_unavailable");
  }
  if (session.role !== expectedRole) {
    throw makeSessionError("登录状态无效，请重新登录");
  }
  if (local.role !== session.role || local.sub !== session.sub || local.exp !== session.exp) {
    throw makeSessionError("登录状态不一致，请重新登录");
  }
  if (expectedSub && session.sub !== expectedSub) {
    throw makeSessionError("登录状态不匹配，请重新登录");
  }
}

function assertUserSessionMatchesToken(token, session, user) {
  const local = decodeJwtPayload(token);
  if (!local || !["user", "admin"].includes(local.role)) {
    throw makeSessionError("登录状态无效，请重新登录");
  }
  if (!session) {
    throw makeSessionError("登录状态暂时无法恢复，请刷新重试", "session_unavailable");
  }
  if (local.role !== session.role || local.sub !== session.sub || local.exp !== session.exp) {
    throw makeSessionError("登录状态不一致，请重新登录");
  }
  if (local.role === "user") {
    if (session.role !== "user" || session.sub !== user?.id) {
      throw makeSessionError("登录状态不匹配，请重新登录");
    }
    return;
  }
  if (session.role !== "admin" || user?.id !== "__admin__") {
    throw makeSessionError("管理员用户前台状态无效，请重新登录");
  }
}

function isAdminVirtualUser(user) {
  return user?.id === "__admin__";
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
  const [userToken, setUserToken] = useState(
    localStorage.getItem(USER_TOKEN_KEY) || localStorage.getItem(ADMIN_TOKEN_KEY) || ""
  );
  const [userSession, setUserSession] = useState(null);
  const [adminState, setAdminState] = useState(null);
  const [adminAuthStatus, setAdminAuthStatus] = useState(() =>
    localStorage.getItem(ADMIN_TOKEN_KEY) ? "checking" : "signedOut"
  );
  const [adminAuthMessage, setAdminAuthMessage] = useState("");
  const [adminUsage, setAdminUsage] = useState(null);
  const [userUsage, setUserUsage] = useState(null);
  const [toast, setToast] = useState({ open: false, message: "", severity: "success" });
  const [confirm, setConfirm] = useState(null);
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [createdKeyInfo, setCreatedKeyInfo] = useState(null);
  const [providerHealth, setProviderHealth] = useState([]);
  const [modelAvailability, setModelAvailability] = useState(null);
  const [publicConfig, setPublicConfig] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [activeAnnouncement, setActiveAnnouncement] = useState(null);
  const [banner, setBanner] = useState(null);
  const [maintenance, setMaintenance] = useState({ maintenanceMode: false, maintenanceEndTime: "" });
  const [themeMode, setThemeMode] = useState(getInitialThemeMode);
  const theme = useMemo(() => createAppTheme(themeMode), [themeMode]);
  const compact = useMediaQuery(theme.breakpoints.down("md"));
  const adminStateWithUsage = useMemo(
    () => (adminState ? { ...adminState, usage: adminUsage } : adminState),
    [adminState, adminUsage]
  );
  const adminAuthenticated = adminAuthStatus === "ready" && Boolean(adminToken) && Boolean(adminState);

  const toggleThemeMode = useCallback(() => {
    setThemeMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem("sapiThemeMode", next);
      return next;
    });
  }, []);

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

  const loadModelAvailability = useCallback(async () => {
    try {
      const data = await request("/api/health/models", { admin: false });
      setModelAvailability(data);
    } catch {
      setModelAvailability(null);
    }
  }, []);

  const loadAdminState = useCallback(async (tokenOverride = "") => {
    const token = tokenOverride || localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!token) {
      throw makeSessionError("请先登录管理员账号");
    }
    const state = await request("/api/admin/session", {
      method: "POST",
      token
    });
    assertSessionMatchesToken(token, state?.session, "admin");
    if (state?.usage) {
      setAdminUsage(state.usage);
    }
    const nextState = state ? { ...state, usage: undefined } : state;
    setAdminState(nextState);
    return nextState;
  }, []);

  const loadAdminUsage = useCallback(async (tokenOverride = "") => {
    const options = tokenOverride ? { token: tokenOverride } : {};
    const data = await request("/api/admin/usage?days=30", options);
    setAdminUsage(data);
    return data;
  }, []);

  const loadUserUsage = useCallback(async (tokenOverride = "") => {
    const token = tokenOverride || localStorage.getItem(USER_TOKEN_KEY);
    if (!token) {
      setUserUsage(null);
      return;
    }
    const data = await request("/api/user/usage?days=365", { admin: false, token });
    setUserUsage(data);
  }, []);

  const loadAdminRequestContent = useCallback(async (id) => {
    const data = await request(`/api/admin/request-logs/${encodeURIComponent(id)}`);
    return data?.requestLog?.requestContent || null;
  }, []);

  const loadUserRequestContent = useCallback(async (id) => {
    const token = localStorage.getItem(USER_TOKEN_KEY);
    const data = await request(`/api/user/request-logs/${encodeURIComponent(id)}`, {
      admin: false,
      token
    });
    return data?.requestLog?.requestContent || null;
  }, []);

  const loadUserSession = useCallback(async (tokenOverride = "") => {
    const token = tokenOverride || localStorage.getItem(USER_TOKEN_KEY);
    if (!token) {
      setUserSession(null);
      return null;
    }

    const data = await request("/api/user/session", {
      method: "POST",
      admin: false,
      token
    });
    assertUserSessionMatchesToken(token, data?.session, data?.user || null);
    localStorage.setItem(USER_TOKEN_KEY, token);
    setUserToken(token);
    setUserSession(data);
    setSelectedKey(data.user.apiKey || "");
    return data;
  }, []);

  const clearAdminSession = useCallback((message = "") => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken("");
    setAdminState(null);
    setAdminUsage(null);
    setAdminAuthStatus("signedOut");
    setAdminAuthMessage(message);
  }, []);

  const clearUserSession = useCallback(() => {
    localStorage.removeItem(USER_TOKEN_KEY);
    setUserToken("");
    setUserSession(null);
    setSelectedKey("");
    setUserUsage(null);
  }, []);

  const logout = useCallback(() => {
    const activeAdminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || adminToken;
    const activeUserToken = localStorage.getItem(USER_TOKEN_KEY) || userToken;
    const userIsAdminSession = userSession?.session?.role === "admin" || (activeAdminToken && activeAdminToken === activeUserToken);
    clearAdminSession();
    if (userIsAdminSession) {
      clearUserSession();
    }
  }, [adminToken, clearAdminSession, clearUserSession, userSession, userToken]);

  const userLogout = useCallback(() => {
    clearUserSession();
  }, [clearUserSession]);

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
    let cancelled = false;
    const poll = async () => {
      await loadModelAvailability();
      if (!cancelled) setTimeout(poll, 300000);
    };
    loadModelAvailability();
    setTimeout(poll, 300000);
    return () => { cancelled = true; };
  }, [loadModelAvailability]);

  useEffect(() => {
    if (route !== "admin" || !adminToken || adminAuthStatus !== "checking") {
      return undefined;
    }

    let cancelled = false;
    setAdminAuthMessage("正在恢复管理后台");

    loadAdminState(adminToken)
      .then(() => {
        if (cancelled) return;
        localStorage.setItem(USER_TOKEN_KEY, adminToken);
        setUserToken(adminToken);
        loadUserSession(adminToken)
          .then(() => loadUserUsage(adminToken).catch(() => {
            if (!cancelled) setUserUsage(null);
          }))
          .catch(() => {
            if (!cancelled) clearUserSession();
          });
        setAdminAuthStatus("ready");
        setAdminAuthMessage("");
        loadAdminUsage(adminToken).catch(() => {
          if (!cancelled) setAdminUsage(null);
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = isAdminAuthFailure(error)
          ? "登录状态已失效，请重新登录"
          : "管理后台暂时无法恢复，请重新登录";
        clearAdminSession(message);
        showToast(error.message || message, "error");
      });

    return () => {
      cancelled = true;
    };
  }, [
    route,
    adminToken,
    adminAuthStatus,
    loadAdminState,
    loadAdminUsage,
    loadUserSession,
    loadUserUsage,
    clearAdminSession,
    clearUserSession,
    showToast
  ]);

  useEffect(() => {
    if (route === "portal" || route === "home") {
      loadMaintenance();
    }
  }, [route, loadMaintenance]);

  useEffect(() => {
    if (userToken && !userSession) {
      loadUserSession(userToken)
        .then(() => loadUserUsage(userToken).catch(() => setUserUsage(null)))
        .catch((error) => {
          userLogout();
          showToast(error.message, "error");
        });
    }
  }, [loadUserSession, loadUserUsage, showToast, userLogout, userSession, userToken]);

  useEffect(() => {
    if (route !== "github-auth") return;

    const run = async () => {
      const hash = window.location.hash || "";
      const queryIndex = hash.indexOf("?");
      const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
      const token = params.get("token") || "";
      const error = params.get("error") || "";

      if (error || !token) {
        showToast(
          error
            ? `GitHub 登录失败：${githubAuthErrorMessage(error, publicConfig?.github?.requiredFollowTarget || "")}`
            : "GitHub 登录失败",
          "error"
        );
        navigate("login");
        return;
      }

      localStorage.setItem(USER_TOKEN_KEY, token);
      clearAdminSession();

      try {
        const session = await loadUserSession(token);
        setUserSession(session);
        setSelectedKey(session.user.apiKey || "");
        await loadUserUsage().catch(() => setUserUsage(null));
        setUserToken(token);
        showToast("已通过 GitHub 登录");
        navigate("portal");
      } catch (err) {
        clearUserSession();
        showToast(err.message, "error");
        navigate("login");
      }
    };

    run();
  }, [clearAdminSession, clearUserSession, loadUserSession, loadUserUsage, publicConfig, route, showToast]);

  const navigate = (nextRoute) => {
    window.location.hash = `#${nextRoute}`;
    setRoute(nextRoute);
    setMobileOpen(false);
  };

  const completeAdminLogin = async (data, message = "已进入管理后台") => {
    const token = data?.token || "";
    if (!token) {
      throw new Error("管理后台登录响应无效");
    }

    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    localStorage.setItem(USER_TOKEN_KEY, token);
    setAdminToken(token);
    setUserToken(token);
    setUserSession(null);
    setSelectedKey("");
    setUserUsage(null);
    setAdminAuthMessage("正在进入管理后台");
    try {
      await Promise.all([loadAdminState(token), loadUserSession(token), loadPublicConfig()]);
      setAdminAuthStatus("ready");
      setAdminAuthMessage("");
    } catch (error) {
      clearAdminSession(
        isAdminAuthFailure(error) ? "登录状态无效，请重新登录" : "管理后台暂时无法进入，请重试"
      );
      clearUserSession();
      throw error;
    }
    loadAdminUsage(token).catch(() => setAdminUsage(null));
    loadUserUsage(token).catch(() => setUserUsage(null));
    showToast(message);
    navigate("admin");
  };

  const loginAdmin = async ({ username, password, captchaTicket, captchaRandstr }) => {
    const data = await request("/api/admin/login", {
      method: "POST",
      admin: false,
      body: { username, password, captchaTicket, captchaRandstr }
    });
    await completeAdminLogin(data);
  };

  const loginUser = async ({ username, password, captchaTicket, captchaRandstr }) => {
    const data = await request("/api/auth/login", {
      method: "POST",
      admin: false,
      body: { username, password, captchaTicket, captchaRandstr }
    });

    if (data.role === "admin") {
      throw new Error("管理员请使用管理后台入口登录");
    }
    if (!data?.token) {
      throw new Error("登录响应无效");
    }

    localStorage.setItem(USER_TOKEN_KEY, data.token);
    clearAdminSession();

    let session = null;
    try {
      session = await loadUserSession(data.token);
      await loadUserUsage().catch(() => setUserUsage(null));
    } catch (error) {
      clearUserSession();
      throw error;
    }

    setUserSession(session);
    setSelectedKey(session.user.apiKey || "");
    setUserToken(data.token);
    showToast("已登录");
    navigate("portal");
  };

  const loginWithAdminPasskey = async () => {
    if (!passkeySupported()) {
      throw new Error("当前浏览器不支持 Passkey");
    }
    const start = await request("/api/admin/passkeys/login/options", {
      method: "POST",
      admin: false,
      body: {}
    });
    const credential = await navigator.credentials.get(decodeRequestOptions(start.options));
    if (!credential) {
      throw new Error("Passkey 登录已取消");
    }
    const data = await request("/api/admin/passkeys/login/finish", {
      method: "POST",
      admin: false,
      body: {
        sessionToken: start.sessionToken,
        credential: encodeLoginCredential(credential)
      }
    });
    await completeAdminLogin(data, "已使用 Passkey 进入管理后台");
  };

  const registerAdminPasskey = async () => {
    if (!passkeySupported()) {
      throw new Error("当前浏览器不支持 Passkey");
    }
    const start = await request("/api/admin/passkeys/register/options", {
      method: "POST",
      body: {}
    });
    const credential = await navigator.credentials.create(decodeCreationOptions(start.options));
    if (!credential) {
      throw new Error("Passkey 绑定已取消");
    }
    await request("/api/admin/passkeys/register/finish", {
      method: "POST",
      body: {
        sessionToken: start.sessionToken,
        name: navigator.platform ? `Admin ${navigator.platform}` : "Admin Passkey",
        credential: encodeRegistrationCredential(credential)
      }
    });
    await Promise.all([loadAdminState(), loadPublicConfig()]);
    showToast("Passkey 已绑定");
  };

  const deleteAdminPasskey = async (passkey) => {
    await request(`/api/admin/passkeys/${encodeURIComponent(passkey.id)}`, {
      method: "DELETE"
    });
    await Promise.all([loadAdminState(), loadPublicConfig()]);
    showToast("Passkey 已删除");
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

  const userRegister = async ({ username, email, password, verificationCode, invitationCode, termsAccepted, captchaTicket, captchaRandstr }) => {
    const data = await request("/api/auth/register", {
      method: "POST",
      admin: false,
      body: { username, email, password, verificationCode, invitationCode, termsAccepted, captchaTicket, captchaRandstr }
    });
    localStorage.setItem(USER_TOKEN_KEY, data.token);
    clearAdminSession();
    const session = await loadUserSession(data.token);
    setUserSession(session);
    setSelectedKey(data.user.apiKey || "");
    setUserToken(data.token);
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
    const session = await loadUserSession(userToken);
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
    if ("collapseModelProviders" in body) {
      const session = await loadUserSession(userToken);
      setUserSession(session);
    } else {
      setUserSession((current) => ({ ...(current || {}), user: data.user }));
    }
    showToast("设置已保存");
  };

  const deleteUserAccount = async () => {
    await request("/api/user/account", {
      method: "DELETE",
      admin: false,
      token: userToken
    });
    userLogout();
    navigate("login");
    showToast("账号已注销");
  };

  const copyText = async (text) => {
    await navigator.clipboard.writeText(text);
    showToast("已复制");
  };

  const afterAdminChange = async (message, options = {}) => {
    const refreshes = [loadAdminState()];
    if (options.refreshPublicConfig) refreshes.push(loadPublicConfig());
    if (options.refreshUsage) refreshes.push(loadAdminUsage());
    if (options.refreshProviders) {
      refreshes.push(loadProviderHealth(), loadModelAvailability());
    }
    await Promise.all(refreshes);
    showToast(message);
  };

  const afterProviderChange = async (message) => {
    await afterAdminChange(message, { refreshProviders: true });
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
      admin={adminAuthenticated}
      onUserLogout={() => {
        const returnToAdmin = adminAuthenticated && isAdminVirtualUser(userSession?.user);
        if (!returnToAdmin) {
          userLogout();
        }
        navigate(returnToAdmin ? "admin" : "login");
        showToast("已退出");
      }}
      onRefresh={() => {
        checkHealth()
          .then(() => showToast("已刷新"))
          .catch((error) => showToast(error.message, "error"));
      }}
      themeMode={themeMode}
      onToggleThemeMode={toggleThemeMode}
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
          admin={adminAuthenticated}
          announcements={announcements}
          themeMode={themeMode}
          onToggleThemeMode={toggleThemeMode}
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

  if (
    route === "login" ||
    route === "register" ||
    (route === "admin" && adminAuthStatus === "signedOut")
  ) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthPage
          mode={route === "register" ? "register" : route === "admin" ? "admin" : "login"}
          onLogin={loginUser}
          onAdminLogin={loginAdmin}
          onPasskeyLogin={route === "admin" ? loginWithAdminPasskey : undefined}
          onRegister={userRegister}
          onSendCode={sendVerificationCode}
          onSendForgotCode={sendForgotPasswordCode}
          onResetPassword={resetPassword}
          onNavigate={navigate}
          onToast={showToast}
          themeMode={themeMode}
          onToggleThemeMode={toggleThemeMode}
          publicConfig={publicConfig}
        />
        {snackbar}
      </ThemeProvider>
    );
  }

  if (route === "github-auth") {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LoadingPage text="正在完成 GitHub 登录" />
        {snackbar}
      </ThemeProvider>
    );
  }

  if (route === "admin" && adminAuthStatus === "checking") {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LoadingPage text={adminAuthMessage || "正在恢复管理后台"} />
        {snackbar}
      </ThemeProvider>
    );
  }

  if (route === "admin" && !adminAuthenticated) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthPage
          mode="admin"
          onLogin={loginUser}
          onAdminLogin={loginAdmin}
          onPasskeyLogin={loginWithAdminPasskey}
          onRegister={userRegister}
          onSendCode={sendVerificationCode}
          onSendForgotCode={sendForgotPasswordCode}
          onResetPassword={resetPassword}
          onNavigate={navigate}
          onToast={showToast}
          themeMode={themeMode}
          onToggleThemeMode={toggleThemeMode}
          publicConfig={publicConfig}
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
        <RequireAccountPage
          onNavigate={navigate}
          themeMode={themeMode}
          onToggleThemeMode={toggleThemeMode}
        />
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
            borderColor: "divider",
            bgcolor: "app.overlay",
            backdropFilter: "blur(12px)"
          }}
        >
          <Toolbar sx={{ gap: 1 }}>
            <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="打开导航">
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              SAPI
            </Typography>
            <ThemeModeToggle mode={themeMode} onToggle={toggleThemeMode} />
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
                bgcolor: "app.sidebarBg",
                color: "app.sidebarText"
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
            pt: { xs: 9, md: 3 },
            px: { xs: 2, sm: 3, lg: 4 },
            pb: 4
          }}
        >
          <Box sx={{ maxWidth: 1280, mx: "auto" }}>
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
                modelAvailability={modelAvailability}
                announcements={announcements}
                onNavigate={navigate}
                onUserLogout={() => {
                  const returnToAdmin = adminAuthenticated && isAdminVirtualUser(userSession?.user);
                  if (!returnToAdmin) {
                    userLogout();
                  }
                  navigate(returnToAdmin ? "admin" : "login");
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
                  Promise.all([loadUserSession(), loadUserUsage(), loadProviderHealth(), loadModelAvailability()])
                    .then(() => showToast("已刷新"))
                    .catch((error) => showToast(error.message, "error"))
                }
                onCopy={copyText}
                onUpdateSettings={(body) =>
                  updateUserSettings(body).catch((error) => showToast(error.message, "error"))
                }
                onDeleteAccount={() =>
                  setConfirm({
                    title: isAdminVirtualUser(userSession?.user) ? "管理员账号不可注销" : "注销账号",
                    message: isAdminVirtualUser(userSession?.user)
                      ? "管理员账号不能从用户前台注销。需要退出时请使用管理后台退出。"
                      : "确认注销当前账号？账号、所有 API Key 和个人请求记录会被删除，操作无法恢复。",
                    confirmText: isAdminVirtualUser(userSession?.user) ? "知道了" : "注销账号",
                    danger: true,
                    action: isAdminVirtualUser(userSession?.user) ? async () => {} : deleteUserAccount
                  })
                }
                onToast={showToast}
                ModelAvailabilityDashboard={ModelAvailabilityDashboard}
                onLoadRequestContent={loadUserRequestContent}
              />
            ) : (
              <AdminView
                page={adminPage}
                state={adminStateWithUsage}
                providerHealth={providerHealth}
                modelAvailability={modelAvailability}
                onLogout={() => {
                  logout();
                  navigate("login");
                  showToast("已退出");
                }}
                onCopy={copyText}
                onRefresh={() =>
                  Promise.all([loadAdminState(), loadAdminUsage(), loadProviderHealth(), loadModelAvailability()])
                    .then(() => showToast("已刷新"))
                    .catch((error) => showToast(error.message, "error"))
                }
                onConfirm={setConfirm}
                afterChange={afterAdminChange}
                afterProviderChange={afterProviderChange}
                onToast={showToast}
                adminToken={adminToken}
                ModelAvailabilityDashboard={ModelAvailabilityDashboard}
                onLoadRequestContent={loadAdminRequestContent}
                onRegisterPasskey={registerAdminPasskey}
                onDeletePasskey={(passkey) =>
                  setConfirm({
                    title: "删除 Passkey",
                    message: `确认删除 ${passkey?.name || "该 Passkey"}？`,
                    confirmText: "删除",
                    danger: true,
                    action: () => deleteAdminPasskey(passkey)
                  })
                }
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
