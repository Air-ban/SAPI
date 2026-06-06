import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import { CLI_TOOLS } from "../constants";
import { request } from "../utils/api";

export function ProviderDialog({ open, onClose, provider, afterChange, onToast }) {
  const isEdit = Boolean(provider);
  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    upstreamFormat: "auto",
    enabled: true,
    failoverThreshold: 3
  });
  const [selectedModels, setSelectedModels] = useState([]);
  const [modelSelectionTouched, setModelSelectionTouched] = useState(false);
  const [lookup, setLookup] = useState({ loading: false, error: "", models: [] });
  const [modelMappings, setModelMappings] = useState([]);
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setForm({ name: "", baseUrl: "", apiKey: "", upstreamFormat: "auto", enabled: true, failoverThreshold: 3, priority: 0 });
    setSelectedModels([]);
    setModelSelectionTouched(false);
    setLookup({ loading: false, error: "", models: [] });
    setModelMappings([]);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (provider) {
      setForm({
        name: provider.name || "",
        baseUrl: provider.baseUrl || "",
        apiKey: "",
        upstreamFormat: provider.upstreamFormat || "auto",
        enabled: provider.enabled !== false,
        failoverThreshold: typeof provider.failoverThreshold === 'number' ? provider.failoverThreshold : 3,
        priority: typeof provider.priority === 'number' ? provider.priority : 0
      });
      const normalized = (provider.models || []).map((m) => {
        if (m && typeof m === "object") return { id: m.id || "", name: m.name || m.id || "", description: m.description || "", cliSupport: Array.isArray(m.cliSupport) ? m.cliSupport : [] };
        return { id: String(m), name: String(m), description: "", cliSupport: [] };
      }).filter((m) => m.id);
      setSelectedModels(normalized);
      setModelSelectionTouched(false);
      setLookup({ loading: false, error: "", models: normalized.map((m) => m.id) });
      const mappings = [];
      const rawMappings = provider.modelMappings || {};
      for (const [customId, upstreamId] of Object.entries(rawMappings)) {
        if (customId && upstreamId) mappings.push({ customId, upstreamId });
      }
      setModelMappings(mappings);
    } else {
      reset();
    }
  }, [open, provider, reset]);

  const closeDialog = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const update = (field) => (event) => {
    const value = field === "enabled" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toggleModel = (modelId) => {
    setModelSelectionTouched(true);
    setSelectedModels((current) => {
      const exists = current.some((m) => m.id === modelId);
      if (exists) {
        return current.filter((m) => m.id !== modelId);
      }
      return [...current, { id: modelId, name: modelId, description: "", cliSupport: [] }];
    });
  };

  const updateModelName = (modelId, name) => {
    setSelectedModels((current) =>
      current.map((m) => (m.id === modelId ? { ...m, name: name || m.id } : m))
    );
  };

  const updateModelDescription = (modelId, description) => {
    setSelectedModels((current) =>
      current.map((m) => (m.id === modelId ? { ...m, description: description || "" } : m))
    );
  };

  const toggleModelCli = (modelId, cliId) => {
    setSelectedModels((current) =>
      current.map((m) => {
        if (m.id !== modelId) return m;
        const set = new Set(m.cliSupport || []);
        if (set.has(cliId)) {
          set.delete(cliId);
        } else {
          set.add(cliId);
        }
        return { ...m, cliSupport: Array.from(set) };
      })
    );
  };

  const fetchModels = useCallback(
    async ({ force = false, signal } = {}) => {
      const baseUrl = form.baseUrl.trim();
      const apiKey = form.apiKey.trim();

      if (!baseUrl || !apiKey) {
        setLookup({ loading: false, error: "", models: [] });
        if (!isEdit) {
          setSelectedModels([]);
          setModelSelectionTouched(false);
        }
        return;
      }

      try {
        new URL(baseUrl);
      } catch {
        setLookup({ loading: false, error: "", models: [] });
        if (!isEdit) {
          setSelectedModels([]);
          setModelSelectionTouched(false);
        }
        return;
      }

      setLookup((current) => ({ ...current, loading: true, error: "" }));
      try {
        const data = await request("/api/admin/providers/models", {
          method: "POST",
          body: { baseUrl, apiKey },
          signal
        });
        const models = data.models || [];

        setLookup({ loading: false, error: "", models });
        setSelectedModels((current) => {
          if (!models.length) return [];
          if (!force && modelSelectionTouched) {
            return current.filter((m) => models.includes(m.id));
          }
          return models.map((id) => {
            const existing = current.find((m) => m.id === id);
            return existing || { id, name: id, description: "", cliSupport: [] };
          });
        });
        if (force) setModelSelectionTouched(false);
        if (force && !models.length) {
          onToast("上游没有返回模型 ID", "warning");
        }
      } catch (error) {
        if (error.name === "AbortError") return;
        setLookup({ loading: false, error: error.message, models: [] });
      }
    },
    [form.apiKey, form.baseUrl, isEdit, modelSelectionTouched, onToast]
  );

  useEffect(() => {
    if (!open) return undefined;
    if (isEdit) return undefined;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchModels({ signal: controller.signal }).catch((error) => {
        if (error.name === "AbortError") return;
        setLookup({ loading: false, error: error.message, models: [] });
      });
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [fetchModels, open, isEdit]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const mappingsObj = {};
      for (const { customId, upstreamId } of modelMappings) {
        if (customId.trim() && upstreamId.trim()) mappingsObj[customId.trim()] = upstreamId.trim();
      }
      const body = { ...form, models: selectedModels, modelMappings: mappingsObj };
      if (isEdit) {
        await request(`/api/admin/providers/${provider.id}`, {
          method: "PUT",
          body
        });
        closeDialog();
        await afterChange("上游 API 已更新");
      } else {
        await request("/api/admin/providers", {
          method: "POST",
          body
        });
        closeDialog();
        await afterChange("上游 API 已保存");
      }
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : closeDialog}
      maxWidth="md"
      fullWidth
      PaperProps={{ component: "form", onSubmit: submit }}
    >
      <DialogTitle>{isEdit ? "编辑上游供应商" : "添加上游供应商"}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.8} sx={{ pt: 1 }}>
          <TextField
            label="名称"
            value={form.name}
            onChange={update("name")}
            placeholder="OpenAI / DeepSeek / 自定义网关"
            required
          />
          <TextField
            label="Base URL"
            value={form.baseUrl}
            onChange={update("baseUrl")}
            placeholder="https://api.openai.com/v1"
            required
          />
          <TextField
            label={isEdit ? "上游 API Key（留空则保持不变）" : "上游 API Key"}
            type="password"
            value={form.apiKey}
            onChange={update("apiKey")}
            placeholder="sk-..."
            required={!isEdit}
          />
          <TextField
            label="上游请求格式"
            value={form.upstreamFormat}
            onChange={update("upstreamFormat")}
            select
            helperText="自动识别失败时可强制转换请求体，避免可用上游因应用层格式不匹配报错。"
          >
            <MenuItem value="auto">自动识别</MenuItem>
            <MenuItem value="openai">OpenAI</MenuItem>
            <MenuItem value="gemini">Gemini</MenuItem>
            <MenuItem value="anthropic">Anthropic</MenuItem>
          </TextField>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <Button
              variant="outlined"
              startIcon={
                lookup.loading ? <CircularProgress color="inherit" size={16} /> : <RefreshIcon />
              }
              onClick={() =>
                fetchModels({ force: true }).catch((error) => {
                  setLookup({ loading: false, error: error.message, models: [] });
                  onToast(error.message, "error");
                })
              }
              disabled={lookup.loading || !form.baseUrl.trim() || !form.apiKey.trim()}
            >
              获取模型
            </Button>
            <Typography variant="body2" color="text.secondary">
              填写上游 /v1 Base URL 和 Key 后会自动尝试读取 /v1/models。
            </Typography>
          </Stack>
          {lookup.error ? <Alert severity="warning">{lookup.error}</Alert> : null}
          {lookup.models.length ? (
            <Stack spacing={1}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ xs: "stretch", sm: "center" }}
                justifyContent="space-between"
              >
                <Typography variant="body2" color="text.secondary">
                  已启用 {selectedModels.length} / {lookup.models.length} 个模型
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setModelSelectionTouched(true);
                      setSelectedModels(lookup.models.map((id) => ({ id, name: id, description: "", cliSupport: [] })));
                    }}
                  >
                    全选
                  </Button>
                  <Button
                    size="small"
                    color="inherit"
                    variant="outlined"
                    onClick={() => {
                      setModelSelectionTouched(true);
                      setSelectedModels([]);
                    }}
                  >
                    清空
                  </Button>
                </Stack>
              </Stack>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                  gap: 1,
                  maxHeight: 300,
                  overflow: "auto",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  p: 1
                }}
              >
                {lookup.models.map((modelId) => {
                  const selected = selectedModels.find((m) => m.id === modelId);
                  const checked = Boolean(selected);

                  return (
                    <Paper
                      key={modelId}
                      variant="outlined"
                      sx={{
                        p: 1,
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto",
                        alignItems: "center",
                        gap: 1,
                        bgcolor: checked ? "app.primarySoft" : "background.paper",
                        borderColor: checked ? "primary.light" : "divider"
                      }}
                    >
                      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          title={modelId}
                          sx={{
                            fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {modelId}
                        </Typography>
                        {checked ? (
                          <>
                            <TextField
                              size="small"
                              placeholder="显示名称"
                              value={selected.name}
                              onChange={(e) => updateModelName(modelId, e.target.value)}
                              sx={{
                                "& .MuiInputBase-root": {
                                  height: 28,
                                  fontSize: "0.8rem"
                                }
                              }}
                            />
                            <TextField
                              size="small"
                              placeholder="模型说明（给用户看的描述）"
                              value={selected.description}
                              onChange={(e) => updateModelDescription(modelId, e.target.value)}
                              sx={{
                                "& .MuiInputBase-root": {
                                  height: 28,
                                  fontSize: "0.8rem"
                                }
                              }}
                            />
                            <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                              {CLI_TOOLS.map((cli) => {
                                const active = (selected.cliSupport || []).includes(cli.id);
                                return (
                                  <Chip
                                    key={cli.id}
                                    label={cli.name}
                                    size="small"
                                    variant={active ? "filled" : "outlined"}
                                    color={active ? "success" : "default"}
                                    onClick={() => toggleModelCli(modelId, cli.id)}
                                    sx={{ fontSize: "0.7rem", height: 22, cursor: "pointer" }}
                                  />
                                );
                              })}
                            </Stack>
                          </>
                        ) : null}
                      </Stack>
                      <Switch
                        checked={checked}
                        onChange={() => toggleModel(modelId)}
                        inputProps={{ "aria-label": `启用 ${modelId}` }}
                      />
                    </Paper>
                  );
                })}
              </Box>
            </Stack>
          ) : (
            <Alert severity="info">填写 Base URL 和 Key 后，系统会自动获取模型 ID 并在这里分栏展示。</Alert>
          )}

          <Stack spacing={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 780 }}>
              模型映射（自定义模型 ID）
            </Typography>
            <Typography variant="body2" color="text.secondary">
              允许为上游模型设置自定义调用 ID。用户通过自定义 ID 调用时，系统会自动替换为对应的真实模型 ID 转发给上游。
            </Typography>
            {modelMappings.length > 0 ? (
              <Stack spacing={1}>
                {modelMappings.map((mapping, index) => (
                  <Stack key={index} direction="row" spacing={1} alignItems="center">
                    <TextField
                      size="small"
                      label="自定义 ID"
                      placeholder="my-model"
                      value={mapping.customId}
                      onChange={(e) => {
                        const value = e.target.value;
                        setModelMappings((current) =>
                          current.map((m, i) => (i === index ? { ...m, customId: value } : m))
                        );
                      }}
                      sx={{ flex: 1 }}
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                      →
                    </Typography>
                    <Autocomplete
                      size="small"
                      freeSolo
                      options={selectedModels.map((m) => m.id)}
                      value={mapping.upstreamId}
                      onChange={(_, value) => {
                        setModelMappings((current) =>
                          current.map((m, i) => (i === index ? { ...m, upstreamId: value || "" } : m))
                        );
                      }}
                      onInputChange={(_, value) => {
                        setModelMappings((current) =>
                          current.map((m, i) => (i === index ? { ...m, upstreamId: value || "" } : m))
                        );
                      }}
                      renderInput={(params) => (
                        <TextField {...params} label="上游模型 ID" placeholder="选择或输入" sx={{ flex: 1 }} />
                      )}
                    />
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        setModelMappings((current) => current.filter((_, i) => i !== index));
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            ) : null}
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setModelMappings((current) => [...current, { customId: "", upstreamId: "" }])}
              sx={{ width: "fit-content" }}
            >
              添加映射
            </Button>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="故障切换阈值"
              type="number"
              value={form.failoverThreshold}
              onChange={update("failoverThreshold")}
              helperText="连续失败达到该次数后自动切换到下一个供应商（0 表示不启用）"
              inputProps={{ min: 0 }}
              sx={{ maxWidth: 200 }}
            />
            <TextField
              label="优先级"
              type="number"
              value={form.priority}
              onChange={update("priority")}
              helperText="数值越大优先级越高，默认 0"
              inputProps={{ min: 0 }}
              sx={{ maxWidth: 200 }}
            />
          </Stack>
          <FormControlLabel
            control={<Switch checked={form.enabled} onChange={update("enabled")} />}
            label="启用"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          onClick={closeDialog}
          disabled={loading}
        >
          取消
        </Button>
        <Button
          type="submit"
          variant="contained"
          startIcon={isEdit ? <EditIcon /> : <AddIcon />}
          disabled={loading || selectedModels.length === 0}
        >
          {isEdit ? "更新" : "保存"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
