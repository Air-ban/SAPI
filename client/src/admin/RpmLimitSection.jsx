import React, { useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import SpeedIcon from "@mui/icons-material/Speed";
import { Section } from "../components/Section";
import { request } from "../utils/api";

export function RpmLimitSection({ defaultRpmLimit, afterChange, onToast }) {
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLimit(defaultRpmLimit);
  }, [defaultRpmLimit]);

  const save = async () => {
    setLoading(true);
    try {
      await request("/api/admin/rpm-limit", {
        method: "PUT",
        body: { defaultRpmLimit: limit }
      });
      await afterChange("全局 RPM 限制已保存");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="全局 RPM 限制" icon={<SpeedIcon />}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          设置每个 API Key 的默认每分钟请求数（RPM）上限。用户可以为单个 Key 设置不同的限制，未设置则使用此全局默认值。
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "flex-start" }}>
          <TextField
            label="默认 RPM 限制"
            type="number"
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
            inputProps={{ min: 1 }}
            sx={{ flex: 1 }}
          />
          <Button
            variant="contained"
            onClick={() => save().catch((e) => onToast(e.message, "error"))}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={16} /> : <SaveIcon />}
            sx={{ height: 56, flexShrink: 0 }}
          >
            保存
          </Button>
        </Stack>
      </Stack>
    </Section>
  );
}
