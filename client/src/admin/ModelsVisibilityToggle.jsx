import React, { useEffect, useState } from "react";
import { FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { Section } from "../components/Section";
import { request } from "../utils/api";

export function ModelsVisibilityToggle({ showOnlyAvailableModels, afterChange, onToast }) {
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setChecked(showOnlyAvailableModels || false);
  }, [showOnlyAvailableModels]);

  const toggle = async (value) => {
    setLoading(true);
    try {
      await request("/api/admin/models-visibility", {
        method: "PUT",
        body: { showOnlyAvailableModels: value }
      });
      setChecked(value);
      await afterChange(value ? "仅显示可用模型" : "显示所有已启用供应商的模型");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="模型可见性" icon={<VisibilityIcon />}>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          开启后，用户的 /v1/models 接口及模型选择列表仅显示仍会被代理路由尝试的模型；健康探测异常但尚未触发故障转移排除的模型不会被误隐藏。
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={checked}
              onChange={(e) => toggle(e.target.checked)}
              disabled={loading}
            />
          }
          label={checked ? "仅显示可路由模型" : "显示所有模型"}
        />
      </Stack>
    </Section>
  );
}
