import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import AddIcon from "@mui/icons-material/Add";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import PriceChangeIcon from "@mui/icons-material/PriceChange";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import SyncIcon from "@mui/icons-material/Sync";
import { Section } from "../components/Section";
import { request } from "../utils/api";
import {
  formatDate,
  formatMoneyFromCents,
  formatMoneyFromMicrounits,
  formatRpmLimit
} from "../utils/helpers";

const PAYMENT_TYPES = [
  { id: "alipay", label: "支付宝" },
  { id: "wxpay", label: "微信" },
  { id: "qqpay", label: "QQ 钱包" }
];

const emptyPrice = {
  modelId: "",
  displayName: "",
  providerId: "",
  inputUsdPerMillionTokens: 0,
  outputUsdPerMillionTokens: 0,
  cacheReadUsdPerMillionTokens: 0,
  cacheWriteUsdPerMillionTokens: 0,
  reasoningUsdPerMillionTokens: 0
};

const BUILTIN_PLAN_IDS = new Set(["email", "lite", "day", "week", "base", "pro", "ultra", "MAX"]);

function centsToYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function yuanToCents(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}

function microunitsToYuan(value) {
  return (Number(value || 0) / 1000000).toFixed(2);
}

function yuanToMicrounits(value) {
  return Math.max(0, Math.round(Number(value || 0) * 1000000));
}

function normalizePlans(plans = []) {
  return plans.map((plan, index) => ({
    id: plan.id || "",
    name: plan.name || plan.id || "",
    description: plan.description || "",
    rpmLimit: Number(plan.rpmLimit || 0),
    priceYuan: centsToYuan(plan.priceCents),
    creditYuan: microunitsToYuan(plan.creditMicrounits),
    durationDays: Number(plan.durationDays || 30),
    modelProviderRoutes: Object.entries(plan.modelProviderRoutes || {}).map(([modelId, providerId]) => ({
      modelId,
      providerId
    })),
    enabled: Boolean(plan.enabled),
    sortOrder: Number(plan.sortOrder || (index + 1) * 10)
  }));
}

function planRoutesToMap(routes = []) {
  const result = {};
  for (const route of routes) {
    const modelId = String(route.modelId || "").trim();
    const providerId = String(route.providerId || "").trim();
    if (modelId && providerId) result[modelId] = providerId;
  }
  return result;
}

function normalizePlanId(value = "") {
  const trimmed = String(value || "").trim();
  if (trimmed.toLowerCase() === "max") return "MAX";
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isBuiltinPlan(plan) {
  return BUILTIN_PLAN_IDS.has(normalizePlanId(plan?.id || ""));
}

export function BillingSettingsSection({
  subscriptionTiers = [],
  providers = [],
  billingConfig = {},
  paymentConfig = {},
  modelPrices = [],
  paymentOrders = [],
  afterChange,
  onConfirm,
  onToast
}) {
  const [plans, setPlans] = useState(() => normalizePlans(subscriptionTiers));
  const [billingForm, setBillingForm] = useState({});
  const [paymentForm, setPaymentForm] = useState({});
  const [savingPlans, setSavingPlans] = useState(false);
  const [savingBilling, setSavingBilling] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [priceSearch, setPriceSearch] = useState("");
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState(emptyPrice);
  const [savingPrice, setSavingPrice] = useState(false);

  useEffect(() => {
    setPlans(normalizePlans(subscriptionTiers));
  }, [subscriptionTiers]);

  useEffect(() => {
    setBillingForm({
      enabled: billingConfig?.enabled !== false,
      currency: billingConfig?.currency || "CNY",
      usdToCnyRate: Number(billingConfig?.usdToCnyRate || 7.2),
      markupMultiplier: Number(billingConfig?.markupMultiplier || 1),
      modelsDevUrl: billingConfig?.modelsDevUrl || "https://models.dev/api.json"
    });
  }, [billingConfig]);

  useEffect(() => {
    setPaymentForm({
      enabled: Boolean(paymentConfig?.enabled),
      gatewayUrl: paymentConfig?.gatewayUrl || "https://www.ezfpy.cn/submit.php",
      mapiUrl: paymentConfig?.mapiUrl || "https://www.ezfpy.cn/mapi.php",
      merchantId: paymentConfig?.merchantId || "",
      merchantKey: "",
      softwareKey: "",
      siteName: paymentConfig?.siteName || "SAPI",
      notifyUrl: paymentConfig?.notifyUrl || "",
      returnUrl: paymentConfig?.returnUrl || "",
      allowedTypes: Array.isArray(paymentConfig?.allowedTypes) && paymentConfig.allowedTypes.length
        ? paymentConfig.allowedTypes
        : ["alipay", "wxpay", "qqpay"]
    });
  }, [paymentConfig]);

  const filteredPrices = useMemo(() => {
    const q = priceSearch.trim().toLowerCase();
    const items = Array.isArray(modelPrices) ? modelPrices : [];
    if (!q) return items.slice(0, 60);
    return items.filter((item) => {
      const text = [
        item.modelId,
        item.displayName,
        item.providerId,
        item.source
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(q);
    }).slice(0, 80);
  }, [modelPrices, priceSearch]);

  const providerOptions = useMemo(() => {
    return (providers || [])
      .map((provider) => ({
        id: String(provider.id || "").trim(),
        label: provider.name ? `${provider.name} (${provider.id})` : provider.id
      }))
      .filter((provider) => provider.id);
  }, [providers]);

  const paidOrders = (paymentOrders || []).filter((order) => order.status === "paid");
  const pendingOrders = (paymentOrders || []).filter((order) => order.status === "pending");

  const updatePlan = (index, patch) => {
    setPlans((current) => current.map((plan, i) => (i === index ? { ...plan, ...patch } : plan)));
  };

  const addPlan = () => {
    setPlans((current) => {
      const nextIndex = current.length + 1;
      const baseId = `custom-${nextIndex}`;
      return [
        ...current,
        {
          id: baseId,
          name: "自定义套餐",
          description: "",
          rpmLimit: 30,
          priceYuan: "0.00",
          creditYuan: "0.00",
          durationDays: 30,
          modelProviderRoutes: [],
          enabled: true,
          sortOrder: nextIndex * 10
        }
      ];
    });
  };

  const removePlan = (index) => {
    const plan = plans[index];
    if (!plan || isBuiltinPlan(plan)) {
      onToast?.("内置套餐不能删除，可关闭启用状态", "warning");
      return;
    }
    setPlans((current) => current.filter((_, i) => i !== index));
  };

  const updatePlanRoute = (planIndex, routeIndex, patch) => {
    setPlans((current) => current.map((plan, index) => {
      if (index !== planIndex) return plan;
      const routes = (plan.modelProviderRoutes || []).map((route, i) => (i === routeIndex ? { ...route, ...patch } : route));
      return { ...plan, modelProviderRoutes: routes };
    }));
  };

  const addPlanRoute = (planIndex) => {
    setPlans((current) => current.map((plan, index) => {
      if (index !== planIndex) return plan;
      return {
        ...plan,
        modelProviderRoutes: [
          ...(plan.modelProviderRoutes || []),
          { modelId: "", providerId: providers[0]?.id || "" }
        ]
      };
    }));
  };

  const removePlanRoute = (planIndex, routeIndex) => {
    setPlans((current) => current.map((plan, index) => {
      if (index !== planIndex) return plan;
      return {
        ...plan,
        modelProviderRoutes: (plan.modelProviderRoutes || []).filter((_, i) => i !== routeIndex)
      };
    }));
  };

  const savePlans = async () => {
    const ids = new Set();
    for (const plan of plans) {
      const id = normalizePlanId(plan.id);
      if (!id) {
        onToast?.("套餐 ID 不能为空", "warning");
        return;
      }
      if (ids.has(id)) {
        onToast?.(`套餐 ID 重复：${id}`, "warning");
        return;
      }
      ids.add(id);

      const routeModels = new Set();
      for (const route of plan.modelProviderRoutes || []) {
        const modelId = String(route.modelId || "").trim();
        const providerId = String(route.providerId || "").trim();
        if (!modelId && !providerId) continue;
        if (!modelId || !providerId) {
          onToast?.(`${plan.name || id} 的模型路由未填写完整`, "warning");
          return;
        }
        const modelKey = modelId.toLowerCase();
        if (routeModels.has(modelKey)) {
          onToast?.(`${plan.name || id} 的模型路由重复：${modelId}`, "warning");
          return;
        }
        routeModels.add(modelKey);
      }
    }
    setSavingPlans(true);
    try {
      await request("/api/admin/subscription-plans", {
        method: "PUT",
        body: {
          subscriptionPlans: plans.map((plan) => ({
            id: normalizePlanId(plan.id),
            name: plan.name,
            description: plan.description,
            rpmLimit: Number(plan.rpmLimit || 0),
            priceCents: yuanToCents(plan.priceYuan),
            creditMicrounits: yuanToMicrounits(plan.creditYuan),
            durationDays: Number(plan.durationDays || 30),
            modelProviderRoutes: planRoutesToMap(plan.modelProviderRoutes),
            enabled: Boolean(plan.enabled),
            sortOrder: Number(plan.sortOrder || 0)
          }))
        }
      });
      await afterChange("订阅套餐已保存", { refreshPublicConfig: true });
    } catch (error) {
      onToast?.(error.message, "error");
    } finally {
      setSavingPlans(false);
    }
  };

  const saveBilling = async () => {
    setSavingBilling(true);
    try {
      await request("/api/admin/billing-config", {
        method: "PUT",
        body: billingForm
      });
      await afterChange("计费配置已保存", { refreshPublicConfig: true, refreshUsage: true });
    } catch (error) {
      onToast?.(error.message, "error");
    } finally {
      setSavingBilling(false);
    }
  };

  const syncModelPrices = async () => {
    setSyncingPrices(true);
    try {
      const result = await request("/api/admin/model-prices/sync", { method: "POST" });
      await afterChange(`已同步 ${result?.syncedCount || 0} 个模型价格`, { refreshUsage: true });
    } catch (error) {
      onToast?.(error.message, "error");
    } finally {
      setSyncingPrices(false);
    }
  };

  const savePayment = async () => {
    setSavingPayment(true);
    try {
      await request("/api/admin/payment-config", {
        method: "PUT",
        body: paymentForm
      });
      await afterChange("易支付配置已保存", { refreshPublicConfig: true });
      setPaymentForm((current) => ({ ...current, merchantKey: "", softwareKey: "" }));
    } catch (error) {
      onToast?.(error.message, "error");
    } finally {
      setSavingPayment(false);
    }
  };

  const openPriceDialog = (price = null) => {
    setEditingPrice(price ? { ...emptyPrice, ...price } : emptyPrice);
    setPriceDialogOpen(true);
  };

  const saveModelPrice = async () => {
    if (!editingPrice.modelId?.trim()) {
      onToast?.("模型 ID 不能为空", "warning");
      return;
    }
    setSavingPrice(true);
    try {
      await request("/api/admin/model-prices", {
        method: "PUT",
        body: {
          ...editingPrice,
          inputUsdPerMillionTokens: Number(editingPrice.inputUsdPerMillionTokens || 0),
          outputUsdPerMillionTokens: Number(editingPrice.outputUsdPerMillionTokens || 0),
          cacheReadUsdPerMillionTokens: Number(editingPrice.cacheReadUsdPerMillionTokens || 0),
          cacheWriteUsdPerMillionTokens: Number(editingPrice.cacheWriteUsdPerMillionTokens || 0),
          reasoningUsdPerMillionTokens: Number(editingPrice.reasoningUsdPerMillionTokens || 0)
        }
      });
      setPriceDialogOpen(false);
      await afterChange("模型价格已保存", { refreshUsage: true });
    } catch (error) {
      onToast?.(error.message, "error");
    } finally {
      setSavingPrice(false);
    }
  };

  const deleteModelPrice = (price) => {
    onConfirm?.({
      title: "删除模型价格",
      message: `确认删除 ${price.modelId} 的价格规则？`,
      confirmText: "删除",
      danger: true,
      action: async () => {
        await request(`/api/admin/model-prices?modelId=${encodeURIComponent(price.modelId)}`, {
          method: "DELETE"
        });
        await afterChange("模型价格已删除", { refreshUsage: true });
      }
    });
  };

  const togglePayType = (type) => {
    setPaymentForm((current) => {
      const allowed = new Set(current.allowedTypes || []);
      if (allowed.has(type)) {
        allowed.delete(type);
      } else {
        allowed.add(type);
      }
      return { ...current, allowedTypes: Array.from(allowed) };
    });
  };

  return (
    <Stack spacing={2.5}>
      <Section
        title="订阅套餐"
        icon={<AccountBalanceWalletIcon />}
        action={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={addPlan}
              disabled={savingPlans}
            >
              新增套餐
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={savingPlans ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={savePlans}
              disabled={savingPlans}
            >
              保存套餐
            </Button>
          </Stack>
        }
      >
        <Stack spacing={1.5}>
          <Alert severity="info" variant="outlined">
            套餐 RPM 会作为用户默认限速；价格、时长和入账额度用于在线支付。模型路由为空时按全局上游优先级选择，填写后会强制走指定上游。
          </Alert>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" }, gap: 1.25 }}>
            {plans.map((plan, index) => (
              <Paper key={`${plan.id || "plan"}-${index}`} variant="outlined" sx={{ p: 1.25, bgcolor: "app.paperAlt" }}>
                <Stack spacing={1.25}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
                    <TextField
                      label="ID"
                      value={plan.id}
                      disabled={isBuiltinPlan(plan)}
                      onChange={(event) => updatePlan(index, { id: event.target.value })}
                      onBlur={(event) => updatePlan(index, { id: normalizePlanId(event.target.value) })}
                      sx={{ width: { xs: "100%", sm: 140 } }}
                    />
                    <TextField label="名称" value={plan.name} onChange={(event) => updatePlan(index, { name: event.target.value })} fullWidth />
                    <FormControlLabel
                      control={<Switch checked={plan.enabled} onChange={(event) => updatePlan(index, { enabled: event.target.checked })} />}
                      label="启用"
                      sx={{ flexShrink: 0 }}
                    />
                    <Tooltip title={isBuiltinPlan(plan) ? "内置套餐可禁用，不能删除" : "删除套餐"}>
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => removePlan(index)}
                          disabled={savingPlans || isBuiltinPlan(plan)}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                  <TextField
                    label="说明"
                    value={plan.description}
                    onChange={(event) => updatePlan(index, { description: event.target.value })}
                    fullWidth
                  />
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(5, minmax(0, 1fr))" }, gap: 1 }}>
                    <TextField label="RPM" type="number" value={plan.rpmLimit} onChange={(event) => updatePlan(index, { rpmLimit: event.target.value })} />
                    <TextField label="价格(元)" type="number" value={plan.priceYuan} onChange={(event) => updatePlan(index, { priceYuan: event.target.value })} />
                    <TextField label="入账额度(元)" type="number" value={plan.creditYuan} onChange={(event) => updatePlan(index, { creditYuan: event.target.value })} />
                    <TextField label="天数" type="number" value={plan.durationDays} onChange={(event) => updatePlan(index, { durationDays: event.target.value })} />
                    <TextField label="排序" type="number" value={plan.sortOrder} onChange={(event) => updatePlan(index, { sortOrder: event.target.value })} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {formatRpmLimit(plan.rpmLimit)} / 售价 {formatMoneyFromCents(yuanToCents(plan.priceYuan))} / 入账 {formatMoneyFromMicrounits(yuanToMicrounits(plan.creditYuan))}
                  </Typography>
                  <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                        <Typography variant="subtitle2" sx={{ fontWeight: 760 }}>
                          模型路由
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AddIcon />}
                          onClick={() => addPlanRoute(index)}
                        >
                          添加模型路由
                        </Button>
                      </Stack>
                      {(plan.modelProviderRoutes || []).length ? (
                        <Stack spacing={1}>
                          {(plan.modelProviderRoutes || []).map((route, routeIndex) => {
                            const routeProviderMissing = route.providerId && !providerOptions.some((provider) => provider.id === route.providerId);
                            return (
                              <Box
                                key={`${route.modelId || "route"}-${routeIndex}`}
                                sx={{
                                  display: "grid",
                                  gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) minmax(180px, 240px) auto" },
                                  gap: 1,
                                  alignItems: "center"
                                }}
                              >
                                <TextField
                                  size="small"
                                  label="模型 ID"
                                  placeholder="gpt-4o-mini"
                                  value={route.modelId || ""}
                                  onChange={(event) => updatePlanRoute(index, routeIndex, { modelId: event.target.value })}
                                />
                                <TextField
                                  select
                                  size="small"
                                  label="路由上游"
                                  value={route.providerId || ""}
                                  onChange={(event) => updatePlanRoute(index, routeIndex, { providerId: event.target.value })}
                                >
                                  <MenuItem value="" disabled>
                                    选择上游
                                  </MenuItem>
                                  {routeProviderMissing ? (
                                    <MenuItem value={route.providerId}>
                                      {route.providerId}（不存在）
                                    </MenuItem>
                                  ) : null}
                                  {providerOptions.map((provider) => (
                                    <MenuItem key={provider.id} value={provider.id}>
                                      {provider.label}
                                    </MenuItem>
                                  ))}
                                </TextField>
                                <Tooltip title="删除路由">
                                  <IconButton size="small" color="error" onClick={() => removePlanRoute(index, routeIndex)}>
                                    <DeleteOutlineIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            );
                          })}
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          未指定模型路由。
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                </Stack>
              </Paper>
            ))}
          </Box>
        </Stack>
      </Section>

      <Section
        title="计费与模型价格"
        icon={<PriceChangeIcon />}
        action={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={syncingPrices ? <CircularProgress size={16} /> : <SyncIcon />}
              onClick={syncModelPrices}
              disabled={syncingPrices}
            >
              同步 models.dev
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={savingBilling ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={saveBilling}
              disabled={savingBilling}
            >
              保存计费
            </Button>
          </Stack>
        }
      >
        <Stack spacing={1.5}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(4, minmax(0, 1fr))" }, gap: 1 }}>
            <TextField
              select
              label="计费开关"
              value={billingForm.enabled ? "on" : "off"}
              onChange={(event) => setBillingForm((current) => ({ ...current, enabled: event.target.value === "on" }))}
            >
              <MenuItem value="on">开启</MenuItem>
              <MenuItem value="off">关闭</MenuItem>
            </TextField>
            <TextField label="币种" value={billingForm.currency || "CNY"} onChange={(event) => setBillingForm((current) => ({ ...current, currency: event.target.value }))} />
            <TextField label="USD/CNY" type="number" value={billingForm.usdToCnyRate ?? 7.2} onChange={(event) => setBillingForm((current) => ({ ...current, usdToCnyRate: Number(event.target.value || 0) }))} />
            <TextField label="加价倍率" type="number" value={billingForm.markupMultiplier ?? 1} onChange={(event) => setBillingForm((current) => ({ ...current, markupMultiplier: Number(event.target.value || 0) }))} />
          </Box>
          <TextField
            label="models.dev API"
            value={billingForm.modelsDevUrl || ""}
            onChange={(event) => setBillingForm((current) => ({ ...current, modelsDevUrl: event.target.value }))}
            fullWidth
            helperText={billingConfig?.lastPriceSyncAt ? `上次同步：${formatDate(billingConfig.lastPriceSyncAt)}` : "默认使用 https://models.dev/api.json"}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
            <TextField
              label="查找模型价格"
              placeholder="模型、供应商或来源"
              value={priceSearch}
              onChange={(event) => setPriceSearch(event.target.value)}
              sx={{ flex: 1 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
            <Button startIcon={<AddIcon />} variant="outlined" onClick={() => openPriceDialog()} sx={{ flexShrink: 0 }}>
              手动价格
            </Button>
          </Stack>
          <TableContainer>
            <Table size="small" sx={{ minWidth: 920 }}>
              <TableHead>
                <TableRow>
                  <TableCell>模型</TableCell>
                  <TableCell>来源</TableCell>
                  <TableCell align="right">Input</TableCell>
                  <TableCell align="right">Output</TableCell>
                  <TableCell align="right">Cache Read</TableCell>
                  <TableCell align="right">Cache Write</TableCell>
                  <TableCell align="right">Reasoning</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPrices.map((price) => (
                  <TableRow key={price.modelId} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace', fontWeight: 760 }} noWrap title={price.modelId}>
                        {price.modelId}
                      </Typography>
                      {price.displayName ? <Typography variant="caption" color="text.secondary" noWrap>{price.displayName}</Typography> : null}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap" }}>
                        {price.providerId ? <Chip size="small" label={price.providerId} variant="outlined" /> : null}
                        <Chip size="small" label={price.manual ? "手动" : price.source || "models.dev"} color={price.manual ? "secondary" : "default"} variant="outlined" />
                      </Stack>
                    </TableCell>
                    <TableCell align="right">${Number(price.inputUsdPerMillionTokens || 0).toFixed(4)}</TableCell>
                    <TableCell align="right">${Number(price.outputUsdPerMillionTokens || 0).toFixed(4)}</TableCell>
                    <TableCell align="right">${Number(price.cacheReadUsdPerMillionTokens || 0).toFixed(4)}</TableCell>
                    <TableCell align="right">${Number(price.cacheWriteUsdPerMillionTokens || 0).toFixed(4)}</TableCell>
                    <TableCell align="right">${Number(price.reasoningUsdPerMillionTokens || 0).toFixed(4)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="编辑">
                        <IconButton size="small" onClick={() => openPriceDialog(price)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton size="small" color="error" onClick={() => deleteModelPrice(price)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary">
            当前显示 {filteredPrices.length} / {modelPrices.length || 0} 个价格规则。价格单位均为 USD / 1M tokens。
          </Typography>
        </Stack>
      </Section>

      <Section
        title="易支付"
        icon={<CreditCardIcon />}
        action={
          <Button
            size="small"
            variant="contained"
            startIcon={savingPayment ? <CircularProgress size={16} /> : <SaveIcon />}
            onClick={savePayment}
            disabled={savingPayment}
          >
            保存支付
          </Button>
        }
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
            <Chip color={paymentConfig?.enabled ? "success" : "default"} variant="outlined" label={paymentConfig?.enabled ? "已开启" : "未开启"} />
            <Chip variant="outlined" label={paymentConfig?.hasKey ? "商户密钥已保存" : "未保存商户密钥"} />
            <Chip variant="outlined" label={paymentConfig?.hasSoftwareKey ? "软件通讯密钥已保存" : "未保存软件通讯密钥"} />
            <Chip variant="outlined" label={`待支付 ${pendingOrders.length}`} />
            <Chip variant="outlined" label={`已支付 ${paidOrders.length}`} />
          </Stack>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1 }}>
            <TextField
              select
              label="在线支付"
              value={paymentForm.enabled ? "on" : "off"}
              onChange={(event) => setPaymentForm((current) => ({ ...current, enabled: event.target.value === "on" }))}
            >
              <MenuItem value="on">开启</MenuItem>
              <MenuItem value="off">关闭</MenuItem>
            </TextField>
            <TextField
              label="Submit 提交 URL"
              value={paymentForm.gatewayUrl || ""}
              onChange={(event) => setPaymentForm((current) => ({ ...current, gatewayUrl: event.target.value }))}
              helperText="表单提交并自动跳转，默认 https://www.ezfpy.cn/submit.php"
            />
            <TextField
              label="MAPI 提交 URL"
              value={paymentForm.mapiUrl || ""}
              onChange={(event) => setPaymentForm((current) => ({ ...current, mapiUrl: event.target.value }))}
              helperText="API 调用返回 JSON，默认 https://www.ezfpy.cn/mapi.php"
            />
            <TextField label="商户 ID" value={paymentForm.merchantId || ""} onChange={(event) => setPaymentForm((current) => ({ ...current, merchantId: event.target.value }))} />
            <TextField
              label="商户密钥"
              type="password"
              value={paymentForm.merchantKey || ""}
              onChange={(event) => setPaymentForm((current) => ({ ...current, merchantKey: event.target.value }))}
              helperText={paymentConfig?.hasKey ? "留空会保留已保存的商户密钥" : "首次开启支付时必须填写"}
            />
            <TextField
              label="软件通讯密钥"
              type="password"
              value={paymentForm.softwareKey || ""}
              onChange={(event) => setPaymentForm((current) => ({ ...current, softwareKey: event.target.value }))}
              helperText={paymentConfig?.hasSoftwareKey ? "留空会保留已保存的软件通讯密钥" : "如易支付后台提供该项，请一并填写"}
            />
            <TextField label="站点名称" value={paymentForm.siteName || ""} onChange={(event) => setPaymentForm((current) => ({ ...current, siteName: event.target.value }))} />
            <TextField label="Notify URL" value={paymentForm.notifyUrl || ""} onChange={(event) => setPaymentForm((current) => ({ ...current, notifyUrl: event.target.value }))} />
            <TextField label="Return URL" value={paymentForm.returnUrl || ""} onChange={(event) => setPaymentForm((current) => ({ ...current, returnUrl: event.target.value }))} />
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            {PAYMENT_TYPES.map((type) => (
              <FormControlLabel
                key={type.id}
                control={
                  <Switch
                    checked={(paymentForm.allowedTypes || []).includes(type.id)}
                    onChange={() => togglePayType(type.id)}
                  />
                }
                label={type.label}
              />
            ))}
          </Stack>
        </Stack>
      </Section>

      <Dialog open={priceDialogOpen} onClose={() => setPriceDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>模型价格</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <TextField label="模型 ID" value={editingPrice.modelId || ""} onChange={(event) => setEditingPrice((current) => ({ ...current, modelId: event.target.value }))} fullWidth />
            <TextField label="显示名称" value={editingPrice.displayName || ""} onChange={(event) => setEditingPrice((current) => ({ ...current, displayName: event.target.value }))} fullWidth />
            <TextField label="Provider ID" value={editingPrice.providerId || ""} onChange={(event) => setEditingPrice((current) => ({ ...current, providerId: event.target.value }))} fullWidth />
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 1 }}>
              <TextField label="Input USD/1M" type="number" value={editingPrice.inputUsdPerMillionTokens ?? 0} onChange={(event) => setEditingPrice((current) => ({ ...current, inputUsdPerMillionTokens: event.target.value }))} />
              <TextField label="Output USD/1M" type="number" value={editingPrice.outputUsdPerMillionTokens ?? 0} onChange={(event) => setEditingPrice((current) => ({ ...current, outputUsdPerMillionTokens: event.target.value }))} />
              <TextField label="Cache Read USD/1M" type="number" value={editingPrice.cacheReadUsdPerMillionTokens ?? 0} onChange={(event) => setEditingPrice((current) => ({ ...current, cacheReadUsdPerMillionTokens: event.target.value }))} />
              <TextField label="Cache Write USD/1M" type="number" value={editingPrice.cacheWriteUsdPerMillionTokens ?? 0} onChange={(event) => setEditingPrice((current) => ({ ...current, cacheWriteUsdPerMillionTokens: event.target.value }))} />
              <TextField label="Reasoning USD/1M" type="number" value={editingPrice.reasoningUsdPerMillionTokens ?? 0} onChange={(event) => setEditingPrice((current) => ({ ...current, reasoningUsdPerMillionTokens: event.target.value }))} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setPriceDialogOpen(false)} disabled={savingPrice}>取消</Button>
          <Button variant="contained" onClick={saveModelPrice} disabled={savingPrice} startIcon={savingPrice ? <CircularProgress size={16} /> : <SaveIcon />}>
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
