import React, { useState } from "react";
import {
  Box,
  Button,
  Stack
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import ApiIcon from "@mui/icons-material/Api";
import BarChartIcon from "@mui/icons-material/BarChart";
import DnsIcon from "@mui/icons-material/Dns";
import KeyIcon from "@mui/icons-material/Key";
import LogoutIcon from "@mui/icons-material/Logout";
import RefreshIcon from "@mui/icons-material/Refresh";
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
import { MaintenanceSection } from "./MaintenanceSection";
import { BannerEditSection } from "./BannerEditSection";
import { RpmLimitSection } from "./RpmLimitSection";
import { AnnouncementsSection } from "./AnnouncementsSection";
import { AdminSuggestionsSection } from "./AdminSuggestionsSection";

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
  onToast,
  adminToken,
  ModelAvailabilityDashboard,
  onLoadRequestContent
}) {
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);

  const providers = state?.providers || [];
  const users = state?.users || [];
  const usage = state?.usage;
  const currentPage = ["overview", "usage", "providers", "responses", "users", "invitations", "smtp", "announcements", "suggestions"].includes(page)
    ? page
    : "overview";
  const pageMeta = {
    overview: { title: "上游 API 与用户 Key", description: "供应商、用户和用量摘要。" },
    usage: { title: "请求与用量", description: "查看全局 Token 统计和最近请求。" },
    providers: { title: "上游供应商", description: "配置模型来源、密钥和启用状态。" },
    users: { title: "用户账号", description: "管理用户 Key 和访问状态。" },
    invitations: { title: "邀请码管理", description: "创建、发送和管理邀请码。" },
    smtp: { title: "SMTP 设置", description: "配置邮件发送服务。" },
    announcements: { title: "公告管理", description: "发布和管理系统公告。" },
    suggestions: { title: "建议反馈", description: "查看用户提交的功能建议和反馈。" }
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

      {ModelAvailabilityDashboard && currentPage === "overview" ? (
        <ModelAvailabilityDashboard availability={modelAvailability} />
      ) : null}

      {providerHealth.length > 0 && currentPage === "overview" ? (
        <ProviderHealthSection providers={providerHealth} />
      ) : null}

      {currentPage === "usage" && usage ? <UsageSection usage={usage} onLoadRequestContent={onLoadRequestContent} /> : null}

      {currentPage === "responses" ? (
        <ProxySettingsSection
          state={state}
          usage={usage}
          providers={providers}
          ProviderRow={ProviderRow}
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
        <Stack spacing={2.5}>
          <SmtpConfigSection
            config={state?.smtpConfig || {}}
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
            defaultRpmLimit={state?.defaultRpmLimit ?? 30}
            afterChange={afterChange}
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
