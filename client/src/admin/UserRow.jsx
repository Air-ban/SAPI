import React, { useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Stack,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import InsightsIcon from "@mui/icons-material/Insights";
import KeyIcon from "@mui/icons-material/Key";
import SettingsIcon from "@mui/icons-material/Settings";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import { EntityRow } from "../components/EntityRow";
import { EmptyState } from "../components/EmptyState";
import { formatDate, formatNumber, formatRpmLimit, getUserApiKeys, subscriptionTierLabel } from "../utils/helpers";
import { request, requestBlob } from "../utils/api";
import { RequestHeatmap } from "../user/RequestHeatmap";
import { ApiKeyRpmRow } from "./ApiKeyRpmRow";

const FALLBACK_TIERS = [
  { id: "email", name: "Email", rpmLimit: 5 },
  { id: "lite", name: "Lite", rpmLimit: 10 },
  { id: "base", name: "Base", rpmLimit: 30 },
  { id: "pro", name: "Pro", rpmLimit: 50 },
  { id: "ultra", name: "Ultra", rpmLimit: 100 },
  { id: "MAX", name: "MAX", rpmLimit: 0 }
];

export function UserRow({ user, usage, subscriptionTiers = FALLBACK_TIERS, afterChange, onConfirm, onCopy, onToast }) {
  const tiers = subscriptionTiers.length ? subscriptionTiers : FALLBACK_TIERS;
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [tierLoading, setTierLoading] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapUsage, setHeatmapUsage] = useState(null);
  const [editForm, setEditForm] = useState({
    name: user.name || "",
    username: user.username || "",
    email: user.email || "",
    enabled: Boolean(user.enabled),
    receiveAnnouncementEmail: Boolean(user.receiveAnnouncementEmail),
    subscriptionTier: user.subscriptionTier || "lite"
  });

  useEffect(() => {
    if (!editOpen) {
      setEditForm({
        name: user.name || "",
        username: user.username || "",
        email: user.email || "",
        enabled: Boolean(user.enabled),
        receiveAnnouncementEmail: Boolean(user.receiveAnnouncementEmail),
        subscriptionTier: user.subscriptionTier || "lite"
      });
    }
  }, [editOpen, user]);

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

  const saveEdit = async () => {
    setEditLoading(true);
    try {
      await request(`/api/admin/users/${user.id}`, {
        method: "PUT",
        body: {
          name: editForm.name,
          username: editForm.username,
          email: editForm.email,
          enabled: editForm.enabled,
          receiveAnnouncementEmail: editForm.receiveAnnouncementEmail,
          subscriptionTier: editForm.subscriptionTier
        }
      });
      setEditOpen(false);
      await afterChange("用户已更新");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setEditLoading(false);
    }
  };

  const switchTier = async (tierId) => {
    if (!tierId || tierId === (user.subscriptionTier || "lite")) return;
    setTierLoading(tierId);
    try {
      await request(`/api/admin/users/${user.id}`, {
        method: "PUT",
        body: { subscriptionTier: tierId }
      });
      await afterChange(`订阅已切换为 ${subscriptionTierLabel(tierId, tiers)}`);
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setTierLoading("");
    }
  };

  const downloadExport = async () => {
    setExportLoading(true);
    try {
      const { blob, filename } = await requestBlob(`/api/admin/users/${user.id}/request-logs/export?days=7&includeContent=true`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || `sapi-user-${user.username || user.id}-request-logs.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onToast("对话数据已导出", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setExportLoading(false);
    }
  };

  const toggleHeatmap = async () => {
    const nextOpen = !heatmapOpen;
    setHeatmapOpen(nextOpen);
    if (!nextOpen || heatmapUsage) return;

    setHeatmapLoading(true);
    try {
      const data = await request(`/api/admin/users/${user.id}/usage?days=365`);
      setHeatmapUsage(data?.usage || null);
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setHeatmapLoading(false);
    }
  };

  const apiKeys = getUserApiKeys(user);
  const sourceLabel = user.source === "github"
    ? "GitHub"
    : user.source === "edu"
      ? "教育邮箱"
      : user.source === "admin"
        ? "管理员"
        : "邮箱";
  const meta = [
    ["API Key", apiKeys.length ? `${apiKeys.length} 个` : "未创建"],
    ["账号", user.username || "-"],
    ["邮箱", user.email || "-"],
    ["订阅", `${subscriptionTierLabel(user.subscriptionTier, tiers)} / ${formatRpmLimit(user.subscriptionRpmLimit ?? user.defaultRpmLimit)}`],
    ["来源", sourceLabel],
    ["创建时间", formatDate(user.createdAt)]
  ];
  if (user.githubLogin) {
    meta.splice(4, 0, ["GitHub", user.githubLogin]);
  }

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
            <Tooltip title="用户管理">
              <IconButton size="small" onClick={() => setExpanded(!expanded)}>
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {apiKeys[0]?.key ? (
              <Tooltip title="复制首个 Key">
                <IconButton size="small" onClick={() => onCopy(apiKeys[0].key)}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title="编辑用户">
              <IconButton size="small" onClick={() => setEditOpen(true)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
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
      {expanded ? (
        <Stack spacing={1.25} sx={{ pl: { xs: 0, md: 7 }, mb: 1 }}>
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "app.paperAlt" }}>
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1}
                alignItems={{ xs: "stretch", md: "center" }}
                justifyContent="space-between"
              >
                <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 780 }}>
                    订阅套餐
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {subscriptionTierLabel(user.subscriptionTier, tiers)} / {formatRpmLimit(user.subscriptionRpmLimit ?? user.defaultRpmLimit)}
                  </Typography>
                </Stack>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={user.subscriptionTier || "lite"}
                  onChange={(_, value) => value && switchTier(value)}
                  sx={{
                    flexWrap: "wrap",
                    gap: 0.75,
                    justifyContent: { xs: "flex-start", md: "flex-end" },
                    "& .MuiToggleButtonGroup-grouped": {
                      m: 0,
                      borderRadius: 1,
                      border: "1px solid",
                      borderColor: "divider"
                    }
                  }}
                >
                  {tiers.map((tier) => (
                    <ToggleButton key={tier.id} value={tier.id} disabled={Boolean(tierLoading)}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <span>{tier.name}</span>
                        {tierLoading === tier.id ? <CircularProgress size={12} /> : null}
                      </Stack>
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={exportLoading ? <CircularProgress size={16} /> : <DownloadIcon />}
                  onClick={downloadExport}
                  disabled={exportLoading}
                  sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
                >
                  导出对话
                </Button>
                <Button
                  size="small"
                  variant={heatmapOpen ? "contained" : "outlined"}
                  startIcon={heatmapLoading ? <CircularProgress size={16} /> : <InsightsIcon />}
                  onClick={toggleHeatmap}
                  disabled={heatmapLoading}
                  sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
                >
                  热力图
                </Button>
              </Stack>
            </Stack>
          </Paper>
          {heatmapOpen ? (
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "app.paperAlt", overflow: "hidden" }}>
              {heatmapLoading ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">加载中</Typography>
                </Stack>
              ) : heatmapUsage?.byDay?.length ? (
                <Stack spacing={1.5}>
                  <RequestHeatmap data={heatmapUsage.byDay} days={365} title={`${user.name || user.username || "用户"} 调用热力图`} />
                  <Typography variant="caption" color="text.secondary">
                    请求 {formatNumber(heatmapUsage.requests)} 次 / {formatNumber(heatmapUsage.totalTokens)} tokens / 失败 {formatNumber(heatmapUsage.failedRequests)} 次
                  </Typography>
                </Stack>
              ) : (
                <EmptyState text="暂无可分析的调用记录。" />
              )}
            </Paper>
          ) : null}
          {apiKeys.length ? (
            <Stack spacing={1}>
              {apiKeys.map((key) => (
                <ApiKeyRpmRow
                  key={key.id || key.key}
                  apiKey={key}
                  userId={user.id}
                  afterChange={afterChange}
                  onToast={onToast}
                />
              ))}
            </Stack>
          ) : null}
        </Stack>
      ) : null}
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
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>编辑用户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="名称"
              value={editForm.name}
              onChange={(e) => setEditForm((current) => ({ ...current, name: e.target.value }))}
              fullWidth
            />
            <TextField
              label="用户名"
              value={editForm.username}
              onChange={(e) => setEditForm((current) => ({ ...current, username: e.target.value }))}
              fullWidth
            />
            <TextField
              label="邮箱"
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((current) => ({ ...current, email: e.target.value }))}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel id={`subscription-tier-${user.id}`}>订阅套餐</InputLabel>
              <Select
                labelId={`subscription-tier-${user.id}`}
                label="订阅套餐"
                value={editForm.subscriptionTier}
                onChange={(e) => setEditForm((current) => ({ ...current, subscriptionTier: e.target.value }))}
              >
                {tiers.map((tier) => (
                  <MenuItem key={tier.id} value={tier.id}>
                    {tier.name} / {formatRpmLimit(tier.rpmLimit)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editForm.enabled}
                    onChange={(e) => setEditForm((current) => ({ ...current, enabled: e.target.checked }))}
                  />
                }
                label="启用账号"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={editForm.receiveAnnouncementEmail}
                    onChange={(e) => setEditForm((current) => ({ ...current, receiveAnnouncementEmail: e.target.checked }))}
                  />
                }
                label="接收公告邮件"
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} color="inherit" disabled={editLoading}>取消</Button>
          <Button
            variant="contained"
            onClick={saveEdit}
            disabled={editLoading}
            startIcon={editLoading ? <CircularProgress size={16} /> : null}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
