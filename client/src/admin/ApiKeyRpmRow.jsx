import React, { useState } from "react";
import {
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { request } from "../utils/api";
import { formatRpmLimit } from "../utils/helpers";

export function ApiKeyRpmRow({ apiKey, userId, afterChange, onToast }) {
  const [rpm, setRpm] = useState(apiKey.rpmLimit > 0 ? String(apiKey.rpmLimit) : "");
  const [loading, setLoading] = useState(false);

  const save = async () => {
    setLoading(true);
    try {
      await request(`/api/admin/users/${userId}/api-keys/${apiKey.id}`, {
        method: "PUT",
        body: { rpmLimit: rpm ? Math.max(1, Number(rpm)) : 0 }
      });
      await afterChange(`${apiKey.name} RPM 已更新`);
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "app.paperAlt" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="center">
        <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <strong>{apiKey.name}</strong> <code>{apiKey.preview || apiKey.key?.slice(0, 12) + "..."}</code>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            有效限制：{formatRpmLimit(apiKey.effectiveRpmLimit)}
          </Typography>
        </Stack>
        <TextField
          label="单 Key RPM"
          type="number"
          size="small"
          value={rpm}
          onChange={(e) => setRpm(e.target.value)}
          placeholder={apiKey.rpmLimit > 0 ? String(apiKey.rpmLimit) : "跟随订阅"}
          inputProps={{ min: 1 }}
          sx={{ width: 140, flexShrink: 0 }}
        />
        <Button
          size="small"
          variant="contained"
          onClick={() => save().catch((e) => onToast(e.message, "error"))}
          disabled={loading}
          sx={{ flexShrink: 0 }}
        >
          {loading ? <CircularProgress size={16} /> : "保存"}
        </Button>
      </Stack>
    </Paper>
  );
}
