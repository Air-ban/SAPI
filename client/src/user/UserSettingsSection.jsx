import React, { useState } from "react";
import {
  Box,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import { Section } from "../components/Section";

export function UserSettingsSection({ user, onUpdateSettings }) {
  const [saving, setSaving] = useState(false);

  const handleToggle = async (checked) => {
    setSaving(true);
    try {
      await onUpdateSettings({ receiveAnnouncementEmail: checked });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="通知偏好" icon={<SettingsIcon />}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr auto" }, gap: 2, alignItems: "center" }}>
            <Stack spacing={0.5}>
              <Typography variant="subtitle1" sx={{ fontWeight: 760 }}>
                接收公告邮件通知
              </Typography>
              <Typography variant="body2" color="text.secondary">
                开启后，当管理员发布新公告时，你会收到邮件通知。如果觉得邮件比较打扰，可以关闭此选项。
              </Typography>
            </Stack>
            <FormControlLabel
              control={
                <Switch
                  checked={user?.receiveAnnouncementEmail !== false}
                  onChange={(e) => handleToggle(e.target.checked)}
                  disabled={saving}
                />
              }
              label=""
              sx={{ m: 0, justifyContent: "flex-end" }}
            />
          </Box>
        </Stack>
      </Paper>
    </Section>
  );
}
