import React, { useState } from "react";
import {
  Box,
  Button,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography
} from "@mui/material";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import SettingsIcon from "@mui/icons-material/Settings";
import { Section } from "../components/Section";

export function UserSettingsSection({ user, onUpdateSettings, onDeleteAccount }) {
  const [saving, setSaving] = useState(false);
  const isAdmin = user?.id === "__admin__";

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
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr auto" },
              gap: 2,
              alignItems: "center",
              pt: 2,
              borderTop: "1px solid",
              borderColor: "divider"
            }}
          >
            <Stack spacing={0.5}>
              <Typography variant="subtitle1" sx={{ fontWeight: 760 }}>
                {isAdmin ? "管理员账号" : "注销账号"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {isAdmin
                  ? "管理员账号在用户前台拥有全部用户功能和不限 RPM，但不能从这里注销。"
                  : "注销后账号和所有 API Key 会立即失效，无法使用当前账号继续登录或调用接口。"}
              </Typography>
            </Stack>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteForeverIcon />}
              onClick={onDeleteAccount}
              disabled={!user || isAdmin}
              sx={{
                color: "error.main",
                borderColor: "error.main",
                "&:hover": {
                  borderColor: "error.main",
                  bgcolor: "app.errorSoft"
                }
              }}
            >
              {isAdmin ? "不可注销" : "注销账号"}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Section>
  );
}
