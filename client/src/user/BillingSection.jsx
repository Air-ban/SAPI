import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import BoltIcon from "@mui/icons-material/Bolt";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SpeedIcon from "@mui/icons-material/Speed";
import { USER_TOKEN_KEY } from "../constants";
import { Metric } from "../components/Metric";
import { Section } from "../components/Section";
import { request } from "../utils/api";
import { formatDate, formatMoneyFromCents, formatMoneyFromMicrounits, formatRpmLimit } from "../utils/helpers";

function openPaymentWindow() {
  try {
    const popup = window.open("", "_blank");
    if (popup) {
      popup.document.write("<!doctype html><title>SAPI Pay</title><body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;color:#111827;\">正在创建支付订单...</body>");
      popup.document.close();
    }
    return popup;
  } catch {
    return null;
  }
}

function submitPaymentForm(gatewayUrl, params, popup) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = gatewayUrl;
  if (popup && !popup.closed) {
    const targetName = `sapi_pay_${Date.now()}`;
    popup.name = targetName;
    form.target = targetName;
  } else {
    form.target = "_self";
  }
  Object.entries(params || {}).forEach(([key, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = String(value ?? "");
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export function BillingSection({ user, usage, billing, onToast }) {
  const [payType, setPayType] = useState("alipay");
  const [orders, setOrders] = useState([]);
  const [billingSummary, setBillingSummary] = useState(null);
  const [loadingTier, setLoadingTier] = useState("");
  const token = localStorage.getItem(USER_TOKEN_KEY);
  const displayUser = billingSummary?.user || user;
  const displayUsage = billingSummary?.usage || usage;
  const plans = billingSummary?.plans || billing?.plans || [];
  const paymentConfig = billingSummary?.paymentConfig || billing?.paymentConfig || {};
  const isAdminVirtual = displayUser?.id === "__admin__";
  const paymentReady = Boolean(paymentConfig.enabled && paymentConfig.merchantId && paymentConfig.hasKey);

  useEffect(() => {
    if (!token) return;
    request("/api/user/billing?days=365", { admin: false, token })
      .then((data) => {
        setBillingSummary(data || null);
        setOrders(data?.orders || []);
      })
      .catch(() => {});
  }, [token]);

  const buyPlan = async (plan) => {
    const popup = openPaymentWindow();
    setLoadingTier(plan.id);
    try {
      const data = await request("/api/user/payments", {
        method: "POST",
        admin: false,
        token,
        body: { subscriptionTier: plan.id, payType }
      });
      if (data?.gatewayUrl && data?.params) {
        submitPaymentForm(data.gatewayUrl, data.params, popup);
      }
      setOrders((items) => [data.order, ...items.filter((item) => item.id !== data.order?.id)].filter(Boolean));
      onToast?.("已创建支付订单，支付完成后会自动入账", "success");
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      onToast?.(error.message, "error");
    } finally {
      setLoadingTier("");
    }
  };

  if (!displayUser) {
    return null;
  }

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
          gap: 2
        }}
      >
        <Metric icon={<AccountBalanceWalletIcon />} label="账户余额" value={formatMoneyFromMicrounits(displayUser.creditBalanceMicrounits)} />
        <Metric icon={<ReceiptLongIcon />} label="近 365 天消耗" value={formatMoneyFromMicrounits(displayUsage?.totalBillableMicrounits)} />
        <Metric icon={<SpeedIcon />} label="当前套餐 RPM" value={formatRpmLimit(displayUser.subscriptionRpmLimit)} />
        <Metric icon={<BoltIcon />} label="累计入账消耗" value={formatMoneyFromMicrounits(displayUser.creditUsedMicrounits)} />
      </Box>

      <Section title="订阅套餐" icon={<CreditCardIcon />}>
        <Stack spacing={1.5}>
          {isAdminVirtual ? (
            <Alert severity="success">管理员用户拥有前台全部功能且不限 RPM，无需购买套餐。</Alert>
          ) : !paymentReady ? (
            <Alert severity="info">在线支付尚未完成配置，套餐信息仍可作为当前限速参考。</Alert>
          ) : null}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
            <TextField
              select
              size="small"
              label="支付方式"
              value={payType}
              onChange={(event) => setPayType(event.target.value)}
              sx={{ width: { xs: "100%", sm: 180 } }}
            >
              {(paymentConfig.allowedTypes || ["alipay", "wxpay", "qqpay"]).map((type) => (
                <MenuItem key={type} value={type}>
                  {type === "wxpay" ? "微信" : type === "qqpay" ? "QQ 钱包" : "支付宝"}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
              gap: 1.5
            }}
          >
            {plans.map((plan) => {
              const active = displayUser.subscriptionTier === plan.id;
              const paid = Number(plan.priceCents || 0) > 0;
              return (
                <Paper key={plan.id} variant="outlined" sx={{ p: 1.5, bgcolor: active ? "app.paperAlt" : "background.paper" }}>
                  <Stack spacing={1.2} sx={{ height: "100%" }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 820 }}>
                        {plan.name || plan.id}
                      </Typography>
                      {active ? <Chip size="small" color="success" label="当前" /> : null}
                    </Stack>
                    <Typography variant="h6" sx={{ fontWeight: 850 }}>
                      {formatMoneyFromCents(plan.priceCents)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatRpmLimit(plan.rpmLimit)} / {plan.durationDays || 30} 天 / 额度 {formatMoneyFromMicrounits(plan.creditMicrounits)}
                    </Typography>
                    {plan.description ? (
                      <Typography variant="caption" color="text.secondary">
                        {plan.description}
                      </Typography>
                    ) : null}
                    <Button
                      variant={active ? "outlined" : "contained"}
                      disabled={isAdminVirtual || !paymentReady || !paid || Boolean(loadingTier)}
                      startIcon={loadingTier === plan.id ? <CircularProgress size={16} /> : <CreditCardIcon />}
                      onClick={() => buyPlan(plan)}
                      sx={{ mt: "auto" }}
                    >
                      {isAdminVirtual ? "管理员无需购买" : paid ? "购买" : "免费套餐"}
                    </Button>
                  </Stack>
                </Paper>
              );
            })}
          </Box>
        </Stack>
      </Section>

      {orders.length ? (
        <Section title="最近订单" icon={<ReceiptLongIcon />}>
          <Stack spacing={1}>
            {orders.slice(0, 5).map((order) => (
              <Paper key={order.id} variant="outlined" sx={{ p: 1.25 }}>
                <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                  <Stack spacing={0.25}>
                    <Typography variant="body2" sx={{ fontWeight: 760 }}>
                      {order.planName || order.subscriptionTier} · {formatMoneyFromCents(order.amountCents)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {order.outTradeNo} · {formatDate(order.createdAt)}
                    </Typography>
                  </Stack>
                  <Chip size="small" color={order.status === "paid" ? "success" : "default"} label={order.status || "pending"} />
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Section>
      ) : null}
    </Stack>
  );
}
