import React, { useState } from "react";
import {
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import KeyIcon from "@mui/icons-material/Key";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import { EntityRow } from "../components/EntityRow";
import { Section } from "../components/Section";
import { EmptyState } from "../components/EmptyState";
import { formatDate } from "../utils/helpers";
import { request } from "../utils/api";

export function AdminApiKeysSection({ apiKeys, usage, onCopy, onConfirm, afterChange, onToast }) {
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
