import React from "react";
import {
  Button,
  IconButton,
  Tooltip
} from "@mui/material";
import ApiIcon from "@mui/icons-material/Api";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import { EntityRow } from "../components/EntityRow";
import { request } from "../utils/api";

export function ProviderRow({ provider, afterChange, onConfirm, onEdit, onToast }) {
  const upstreamFormat = provider.upstreamFormat || "auto";
  const upstreamFormatLabels = {
    auto: "自动识别",
    openai: "OpenAI",
    gemini: "Gemini",
    anthropic: "Anthropic"
  };

  const toggle = async () => {
    await request(`/api/admin/providers/${provider.id}`, {
      method: "PUT",
      body: {
        name: provider.name,
        baseUrl: provider.baseUrl,
        upstreamFormat,
        models: provider.models,
        modelMappings: provider.modelMappings,
        enabled: !provider.enabled,
        failoverThreshold: typeof provider.failoverThreshold === 'number' ? provider.failoverThreshold : 3,
        priority: typeof provider.priority === 'number' ? provider.priority : 0
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

  const mappingLabels = Object.entries(provider.modelMappings || {})
    .map(([customId, upstreamId]) => `${customId}→${upstreamId}`);

  const failures = provider.consecutiveFailures || 0;
  const threshold = typeof provider.failoverThreshold === "number" ? provider.failoverThreshold : 3;
  const failureLabel = failures > 0 && threshold > 0
    ? `连续失败 ${failures}/${threshold} 次`
    : null;

  let failoverChip = null;
  if (!provider.isAvailableForFailover && threshold > 0) {
    failoverChip = { label: "已排除", color: "error" };
  } else if (failures > 0 && threshold > 0) {
    failoverChip = { label: "备用中", color: "warning" };
  } else if (threshold > 0) {
    failoverChip = { label: "正常", color: "success" };
  }

  return (
    <EntityRow
      title={provider.name}
      enabled={provider.enabled}
      failoverChip={failoverChip}
      icon={<ApiIcon />}
      meta={[
        ["Base URL", provider.baseUrl],
        ["上游格式", upstreamFormatLabels[upstreamFormat] || upstreamFormat],
        ["API Key", provider.apiKey || "-"],
        ["模型", modelLabels.join(", ") || "-"],
        ...(mappingLabels.length ? [["映射", mappingLabels.join(", ")]] : []),
        ["优先级", typeof provider.priority === 'number' ? provider.priority : 0],
        ...(failureLabel ? [["故障切换", failureLabel]] : [])
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
