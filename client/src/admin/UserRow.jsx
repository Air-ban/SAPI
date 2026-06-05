import React, { useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Switch,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import KeyIcon from "@mui/icons-material/Key";
import SettingsIcon from "@mui/icons-material/Settings";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import { EntityRow } from "../components/EntityRow";
import { formatDate, getUserApiKeys } from "../utils/helpers";
import { request } from "../utils/api";
import { ApiKeyRpmRow } from "./ApiKeyRpmRow";

export function UserRow({ user, usage, afterChange, onConfirm, onCopy, onToast }) {
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({
    name: user.name || "",
    username: user.username || "",
    email: user.email || "",
    enabled: Boolean(user.enabled),
    receiveAnnouncementEmail: Boolean(user.receiveAnnouncementEmail)
  });

  useEffect(() => {
    if (!editOpen) {
      setEditForm({
        name: user.name || "",
        username: user.username || "",
        email: user.email || "",
        enabled: Boolean(user.enabled),
        receiveAnnouncementEmail: Boolean(user.receiveAnnouncementEmail)
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
          receiveAnnouncementEmail: editForm.receiveAnnouncementEmail
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
            {apiKeys.length ? (
              <Tooltip title="管理 API Key">
                <IconButton size="small" onClick={() => setExpanded(!expanded)}>
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
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
      {expanded && apiKeys.length ? (
        <Stack spacing={1} sx={{ pl: { xs: 0, md: 7 }, mb: 1 }}>
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
