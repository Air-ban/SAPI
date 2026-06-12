import React, { useState } from "react";
import {
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import RestoreIcon from "@mui/icons-material/Restore";
import SpeedIcon from "@mui/icons-material/Speed";
import { Section } from "../components/Section";
import { formatRpmLimit } from "../utils/helpers";
import { request } from "../utils/api";

export function RpmLimitSection({ subscriptionTiers = [], afterChange, onConfirm, onToast }) {
  const [loadingTier, setLoadingTier] = useState("");

  const applyTier = (tier) => {
    onConfirm({
      title: "全局调整 RPM",
      message: `确认将所有用户一键切换为 ${tier.name}（${formatRpmLimit(tier.rpmLimit)}）？`,
      confirmText: "应用",
      danger: tier.id === "MAX",
      action: async () => {
        setLoadingTier(tier.id);
        try {
          const result = await request("/api/admin/subscriptions/global-tier", {
            method: "PUT",
            body: { subscriptionTier: tier.id }
          });
          await afterChange(`已调整 ${result.changedUsers || 0}/${result.totalUsers || 0} 个用户`);
        } catch (error) {
          onToast(error.message, "error");
        } finally {
          setLoadingTier("");
        }
      }
    });
  };

  const restoreDefaults = () => {
    onConfirm({
      title: "恢复默认订阅",
      message: "确认按用户来源恢复默认订阅？普通邮箱为 Email，edu.cn 为 Base，GitHub 为 Lite。",
      confirmText: "恢复",
      action: async () => {
        setLoadingTier("restore-defaults");
        try {
          const result = await request("/api/admin/subscriptions/global-tier", {
            method: "PUT",
            body: { restoreDefaults: true }
          });
          await afterChange(`已恢复 ${result.changedUsers || 0}/${result.totalUsers || 0} 个用户`);
        } catch (error) {
          onToast(error.message, "error");
        } finally {
          setLoadingTier("");
        }
      }
    });
  };

  return (
    <Section
      title="订阅 RPM 档位"
      icon={<SpeedIcon />}
      action={
        <Button
          size="small"
          variant="outlined"
          startIcon={loadingTier === "restore-defaults" ? <CircularProgress size={14} /> : <RestoreIcon />}
          onClick={restoreDefaults}
          disabled={Boolean(loadingTier)}
        >
          恢复默认订阅
        </Button>
      }
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          普通邮箱默认 Email，edu.cn 默认 Base，GitHub 默认 Lite。API Key 留空时跟随订阅分组，填写数值时只会作为更低的单 Key 限制。
        </Typography>
        <Stack
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(6, minmax(0, 1fr))" },
            gap: 1
          }}
        >
          {subscriptionTiers.map((tier) => (
            <Paper key={tier.id} variant="outlined" sx={{ p: 1.25, bgcolor: "app.paperAlt" }}>
              <Stack spacing={1} sx={{ minHeight: 104 }}>
                <Stack spacing={0.25} sx={{ flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 780 }}>
                    {tier.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatRpmLimit(tier.rpmLimit)}
                  </Typography>
                </Stack>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={loadingTier === tier.id ? <CircularProgress size={14} /> : <BoltIcon />}
                  onClick={() => applyTier(tier)}
                  disabled={Boolean(loadingTier)}
                  sx={{ alignSelf: "stretch" }}
                >
                  一键应用
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Stack>
    </Section>
  );
}
