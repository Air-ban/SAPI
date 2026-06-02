import React, { useState } from "react";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
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
    </>
  );
}
