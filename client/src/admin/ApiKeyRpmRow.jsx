import React, { useState } from "react";
import {
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { request } from "../utils/api";
import { formatDate, formatRpmLimit } from "../utils/helpers";

export function ApiKeyRpmRow({ apiKey, userId, afterChange, onToast, onCopy }) {
  const [rpm, setRpm] = useState(apiKey.rpmLimit > 0 ? String(apiKey.rpmLimit) : "");
  const [loading, setLoading] = useState(false);
  const [banLoading, setBanLoading] = useState(false);

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

  const toggleBan = async () => {
    setBanLoading(true);
    try {
      await request(`/api/admin/users/${userId}/api-keys/${apiKey.id}`, {
        method: "PUT",
        body: { banned: !apiKey.isBanned }
      });
      await afterChange(apiKey.isBanned ? `${apiKey.name} 已解封` : `${apiKey.name} 已封禁 1 小时`);
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setBanLoading(false);
    }
  };
  const displayKey = apiKey.key || apiKey.preview || "-";

  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "app.paperAlt" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="center">
        <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            <strong>{apiKey.name}</strong> <code>{displayKey}</code>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            有效限制：{formatRpmLimit(apiKey.effectiveRpmLimit)}
            {apiKey.invalidRequestCount > 0 ? ` / 异常请求体 ${apiKey.invalidRequestCount} 次` : ""}
            {apiKey.isBanned ? ` / 封禁至 ${formatDate(apiKey.bannedUntil)}` : ""}
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
        <Tooltip title="复制 Key">
          <IconButton onClick={() => onCopy?.(apiKey.key)} disabled={!apiKey.key} sx={{ flexShrink: 0 }}>
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>
        <Button
          size="small"
          variant="contained"
          onClick={() => save().catch((e) => onToast(e.message, "error"))}
          disabled={loading}
          sx={{ flexShrink: 0 }}
        >
          {loading ? <CircularProgress size={16} /> : "保存"}
        </Button>
        <Button
          size="small"
          variant={apiKey.isBanned ? "contained" : "outlined"}
          color={apiKey.isBanned ? "success" : "warning"}
          startIcon={banLoading ? <CircularProgress size={16} /> : <BlockIcon />}
          onClick={() => toggleBan().catch((e) => onToast(e.message, "error"))}
          disabled={banLoading}
          sx={{ flexShrink: 0 }}
        >
          {apiKey.isBanned ? "解封" : "封禁1小时"}
        </Button>
      </Stack>
    </Paper>
  );
}
