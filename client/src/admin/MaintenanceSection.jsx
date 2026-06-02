import React, { useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import WarningIcon from "@mui/icons-material/Warning";
import { Section } from "../components/Section";
import { request } from "../utils/api";

export function MaintenanceSection({ maintenance, afterChange, onToast }) {
  const [enabled, setEnabled] = useState(false);
  const [endTime, setEndTime] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEnabled(maintenance?.maintenanceMode || false);
    setEndTime(maintenance?.maintenanceEndTime || "");
  }, [maintenance]);

  const toggle = async (checked) => {
    setLoading(true);
    try {
      await request("/api/admin/maintenance", {
        method: "PUT",
        body: {
          maintenanceMode: checked,
          maintenanceEndTime: checked ? endTime : ""
        }
      });
      setEnabled(checked);
      if (!checked) setEndTime("");
      await afterChange(checked ? "维护模式已开启，所有 API 请求将被阻止" : "维护模式已关闭");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const saveEndTime = async () => {
    setLoading(true);
    try {
      await request("/api/admin/maintenance", {
        method: "PUT",
        body: {
          maintenanceMode: enabled,
          maintenanceEndTime: endTime
        }
      });
      await afterChange("预计恢复时间已更新");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="维护模式" icon={<WarningIcon />}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          开启维护模式后，所有用户的 API 请求将被阻止（返回 503），用户端页面将显示维护通知。
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(e) => toggle(e.target.checked).catch((e) => onToast(e.message, "error"))}
              disabled={loading}
            />
          }
          label={enabled ? "维护模式已开启" : "开启维护模式"}
        />
        {enabled ? (
          <>
            <TextField
              label="预计恢复时间"
              type="datetime-local"
              value={endTime.slice(0, 16)}
              onChange={(e) => setEndTime(e.target.value ? new Date(e.target.value).toISOString() : "")}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <Stack direction="row" spacing={1.5} justifyContent="flex-end">
              <Button
                variant="contained"
                onClick={() => saveEndTime().catch((e) => onToast(e.message, "error"))}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={16} /> : <SaveIcon />}
              >
                保存时间
              </Button>
            </Stack>
          </>
        ) : null}
      </Stack>
    </Section>
  );
}
