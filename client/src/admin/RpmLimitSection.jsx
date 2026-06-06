import React from "react";
import {
  Chip,
  Stack,
  Typography
} from "@mui/material";
import SpeedIcon from "@mui/icons-material/Speed";
import { Section } from "../components/Section";
import { formatRpmLimit } from "../utils/helpers";

export function RpmLimitSection({ subscriptionTiers = [] }) {
  return (
    <Section title="订阅 RPM 档位" icon={<SpeedIcon />}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          用户默认分组为 Lite。管理员在用户账号编辑窗口调整订阅分组，API Key 留空时跟随订阅分组，填写数值时只会作为更低的单 Key 限制。
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {subscriptionTiers.map((tier) => (
            <Chip
              key={tier.id}
              label={`${tier.name} / ${formatRpmLimit(tier.rpmLimit)}`}
              variant="outlined"
              color={tier.id === "MAX" ? "secondary" : "primary"}
            />
          ))}
        </Stack>
      </Stack>
    </Section>
  );
}
