import React, { useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import ApiIcon from "@mui/icons-material/Api";
import BarChartIcon from "@mui/icons-material/BarChart";
import ClearIcon from "@mui/icons-material/Clear";
import DownloadIcon from "@mui/icons-material/Download";
import DnsIcon from "@mui/icons-material/Dns";
import KeyIcon from "@mui/icons-material/Key";
import LogoutIcon from "@mui/icons-material/Logout";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import { PageHeader } from "../components/PageHeader";
import { Metric } from "../components/Metric";
import { Section } from "../components/Section";
import { EmptyState } from "../components/EmptyState";
import { formatNumber } from "../utils/helpers";
import { UsageSection } from "../user/UsageSection";
import { ProxySettingsSection } from "../user/ProxySettingsSection";
import { ProviderHealthSection } from "./ProviderHealthSection";
import { ProviderDialog } from "./ProviderDialog";
import { ProviderRow } from "./ProviderRow";
import { UserRow } from "./UserRow";
import { AdminApiKeysSection } from "./AdminApiKeysSection";
import { InvitationCodesSection } from "./InvitationCodesSection";
import { SmtpConfigSection } from "./SmtpConfigSection";
import { RegistrationSection } from "./RegistrationSection";
import { MaintenanceSection } from "./MaintenanceSection";
import { BannerEditSection } from "./BannerEditSection";
import { RpmLimitSection } from "./RpmLimitSection";
import { ModelsVisibilityToggle } from "./ModelsVisibilityToggle";
import { AnnouncementsSection } from "./AnnouncementsSection";
import { AdminSuggestionsSection } from "./AdminSuggestionsSection";
import { AdminPasskeysSection } from "./AdminPasskeysSection";
import { ServerStatusSection } from "./ServerStatusSection";
import { requestBlob } from "../utils/api";

export function AdminView({
  page = "overview",
  state,
  providerHealth,
  modelAvailability,
  onLogout,
  onCopy,
  onRefresh,
  onConfirm,
  afterChange,
  afterProviderChange = afterChange,
  onToast,
  adminToken,
  ModelAvailabilityDashboard,
  onLoadRequestContent,
  onRegisterPasskey,
  onDeletePasskey
}) {
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [userSearch, setUserSearch] = useState("");
  const [globalExportLoading, setGlobalExportLoading] = useState(false);

  const providers = state?.providers || [];
  const users = state?.users || [];
  const usage = state?.usage;
  const subscriptionTiers = state?.subscriptionTiers || [];
  const normalizedUserSearch = userSearch.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    if (!normalizedUserSearch) {
      return users;
    }
    return users.filter((user) => {
      const username = String(user.username || "").toLowerCase();
      const email = String(user.email || "").toLowerCase();
      return username.includes(normalizedUserSearch) || email.includes(normalizedUserSearch);
    });
  }, [users, normalizedUserSearch]);
  const currentPage = ["overview", "usage", "server", "providers", "responses", "users", "invitations", "smtp", "announcements", "suggestions"].includes(page)
    ? page
    : "overview";
  const pageMeta = {
    overview: { title: "上游 API 与用户 Key", description: "供应商、用户和用量摘要。" },
    usage: { title: "请求与用量", description: "查看全局 Token 统计和最近请求。" },
    server: { title: "服务器中控", description: "查看 fastfetch 主机状态、Go 运行时和存储健康信息。" },
    providers: { title: "上游供应商", description: "配置模型来源、密钥和启用状态。" },
    users: { title: "用户账号", description: "管理用户 Key 和访问状态。" },
    invitations: { title: "邀请码管理", description: "创建、发送和管理邀请码。" },
    smtp: { title: "总设置", description: "集中配置邮件服务、注册开关、站点横幅、维护模式和全局 RPM 档位。" },
    announcements: { title: "公告管理", description: "发布和管理系统公告。" },
    suggestions: { title: "建议反馈", description: "查看用户提交的功能建议和反馈。" }
  }[currentPage] || {
    title: "上游 API 与用户 Key",
    description: "供应商、用户和用量摘要。"
  };

  const downloadGlobalRequestLogs = async () => {
    setGlobalExportLoading(true);
    try {
      const { blob, filename } = await requestBlob("/api/admin/request-logs/export?days=7&includeContent=true");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "sapi-request-logs.tar.gz";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onToast?.("请求日志已导出", "success");
    } catch (error) {
      onToast?.(error.message, "error");
    } finally {
      setGlobalExportLoading(false);
    }
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

      {ModelAvailabilityDashboard && currentPage === "overview" ? (
        <ModelAvailabilityDashboard availability={modelAvailability} />
      ) : null}

      {providerHealth.length > 0 && currentPage === "overview" ? (
        <ProviderHealthSection providers={providerHealth} />
      ) : null}

      {currentPage === "usage" && usage ? (
        <Stack spacing={1.5}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="flex-end" alignItems={{ xs: "stretch", sm: "center" }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={globalExportLoading ? <CircularProgress size={16} /> : <DownloadIcon />}
              onClick={downloadGlobalRequestLogs}
              disabled={globalExportLoading}
              sx={{ alignSelf: { xs: "stretch", sm: "flex-end" } }}
            >
              导出近 7 天日志
            </Button>
          </Stack>
          <UsageSection usage={usage} onLoadRequestContent={onLoadRequestContent} />
        </Stack>
      ) : null}

      {currentPage === "server" ? <ServerStatusSection onToast={onToast} /> : null}

      {currentPage === "responses" ? (
        <ProxySettingsSection
          state={state}
          usage={usage}
          providers={providers}
          ProviderRow={ProviderRow}
          onCopy={onCopy}
          onAddProvider={() => setProviderDialogOpen(true)}
          onEditProvider={{
            afterChange: afterProviderChange,
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
        <>
          <ModelsVisibilityToggle
            showOnlyAvailableModels={state?.showOnlyAvailableModels}
            afterChange={afterChange}
            onToast={onToast}
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
                  afterChange={afterProviderChange}
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
        </>
      ) : null}

      <ProviderDialog
        open={providerDialogOpen}
        provider={editingProvider}
        onClose={() => {
          setProviderDialogOpen(false);
          setEditingProvider(null);
        }}
        afterChange={afterProviderChange}
        onToast={onToast}
      />

      {currentPage === "users" ? (
        <>
          <Section title="用户账号" icon={<KeyIcon />}>
            {users.length ? (
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  alignItems={{ xs: "stretch", sm: "center" }}
                  justifyContent="space-between"
                >
                  <TextField
                    size="small"
                    label="查找用户"
                    placeholder="邮箱或用户名"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    sx={{ width: { xs: "100%", sm: 360 }, maxWidth: "100%" }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                      endAdornment: userSearch ? (
                        <InputAdornment position="end">
                          <Tooltip title="清空">
                            <IconButton
                              aria-label="清空用户查找"
                              edge="end"
                              size="small"
                              onClick={() => setUserSearch("")}
                            >
                              <ClearIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ) : null
                    }}
                  />
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ whiteSpace: "nowrap", alignSelf: { xs: "flex-start", sm: "center" } }}
                  >
                    {normalizedUserSearch ? `找到 ${filteredUsers.length} / ${users.length}` : `共 ${users.length} 个用户`}
                  </Typography>
                </Stack>
                {filteredUsers.length ? filteredUsers.map((user) => {
                  const userUsage = usage?.byUser?.find((u) => u.userId === user.id);
                  return (
                    <UserRow
                      key={user.id}
                      user={user}
                      usage={userUsage}
                      subscriptionTiers={subscriptionTiers}
                      afterChange={afterChange}
                      onConfirm={onConfirm}
                      onCopy={onCopy}
                      onToast={onToast}
                    />
                  );
                }) : (
                  <EmptyState text="没有匹配的用户。" />
                )}
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
          <AdminPasskeysSection
            passkeys={state?.adminPasskeys || []}
            onRegister={onRegisterPasskey}
            onDelete={onDeletePasskey}
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
        <Stack spacing={2.5}>
          <SmtpConfigSection
            config={state?.smtpConfig || {}}
            afterChange={afterChange}
            onToast={onToast}
          />
          <RegistrationSection
            registrationDisabled={state?.registrationDisabled}
            afterChange={afterChange}
            onToast={onToast}
          />
          <MaintenanceSection
            maintenance={state ? { maintenanceMode: state.maintenanceMode, maintenanceEndTime: state.maintenanceEndTime } : { maintenanceMode: false, maintenanceEndTime: "" }}
            afterChange={afterChange}
            onToast={onToast}
          />
          <BannerEditSection
            banner={state?.siteBanner}
            afterChange={afterChange}
            onToast={onToast}
          />
          <RpmLimitSection
            subscriptionTiers={subscriptionTiers}
            afterChange={afterChange}
            onConfirm={onConfirm}
            onToast={onToast}
          />
        </Stack>
      ) : null}

      {currentPage === "announcements" ? (
        <AnnouncementsSection
          announcements={state?.announcements || []}
          afterChange={afterChange}
          onConfirm={onConfirm}
          onToast={onToast}
        />
      ) : null}

      {currentPage === "suggestions" ? (
        <AdminSuggestionsSection
          suggestions={state?.suggestions || []}
          afterChange={afterChange}
          onConfirm={onConfirm}
          onToast={onToast}
        />
      ) : null}
    </Stack>
  );
}
