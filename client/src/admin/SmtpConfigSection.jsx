import React, { useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from "@mui/material";
import MailIcon from "@mui/icons-material/Mail";
import SettingsIcon from "@mui/icons-material/Settings";
import { Section } from "../components/Section";
import { request } from "../utils/api";
import { SiteEmailSection } from "./SiteEmailSection";

export function SmtpConfigSection({ config, afterChange, onToast }) {
  const [form, setForm] = useState({
    host: "",
    port: 587,
    secure: false,
    user: "",
    pass: "",
    from: ""
  });
  const [loading, setLoading] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    if (config) {
      setForm({
        host: config.host || "",
        port: config.port || 587,
        secure: config.secure || false,
        user: config.user || "",
        pass: "",
        from: config.from || ""
      });
    }
  }, [config]);

  const update = (field) => (event) => {
    const value = field === "secure" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    setLoading(true);
    try {
      await request("/api/admin/smtp-config", {
        method: "PUT",
        body: form
      });
      await afterChange("SMTP 配置已保存");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const test = async () => {
    if (!testEmail) {
      onToast("请输入测试邮箱地址", "warning");
      return;
    }
    setTestLoading(true);
    try {
      await request("/api/admin/smtp-config/test", {
        method: "POST",
        body: { to: testEmail }
      });
      onToast("测试邮件已发送，请检查收件箱和垃圾邮件文件夹", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Section title="SMTP 配置" icon={<SettingsIcon />}>
        <Stack spacing={2.5}>
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 780, color: 'text.secondary' }}>
                服务器设置
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="SMTP 服务器" value={form.host} onChange={update("host")} placeholder="smtp.example.com" sx={{ flex: 1 }} />
                <TextField label="端口" type="number" value={form.port} onChange={update("port")} sx={{ width: 140 }} />
              </Stack>
              <FormControlLabel
                control={<Switch checked={form.secure} onChange={update("secure")} />}
                label="使用 SSL/TLS（端口 465 通常需要启用）"
              />
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 780, color: 'text.secondary' }}>
                认证信息
              </Typography>
              <TextField label="用户名" value={form.user} onChange={update("user")} placeholder="your-email@example.com" />
              <TextField
                label="密码"
                type="password"
                value={form.pass}
                onChange={update("pass")}
                placeholder={config.hasPass ? "已设置，留空保持不变" : "SMTP 密码"}
              />
              <TextField
                label="发件人地址"
                value={form.from}
                onChange={update("from")}
                placeholder="noreply@example.com"
                helperText="留空则使用用户名作为发件人。"
              />
            </Stack>
          </Paper>

          <Stack direction="row" spacing={1.5} justifyContent="flex-end">
            <Button
              variant="contained"
              onClick={() => save().catch((e) => onToast(e.message, "error"))}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : null}
            >
              保存配置
            </Button>
          </Stack>
        </Stack>
      </Section>

      <Section title="连接测试" icon={<MailIcon />}>
        <Stack spacing={2} direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "flex-start" }}>
          <TextField
            label="测试邮箱地址"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="your-email@example.com"
            sx={{ flex: 1 }}
          />
          <Button
            variant="outlined"
            onClick={() => test().catch((e) => onToast(e.message, "error"))}
            disabled={testLoading}
            startIcon={testLoading ? <CircularProgress size={16} /> : <MailIcon />}
            sx={{ height: 56, mt: { sm: 0 }, flexShrink: 0 }}
          >
            发送测试邮件
          </Button>
        </Stack>
      </Section>

      <SiteEmailSection afterChange={afterChange} onToast={onToast} />
    </Stack>
  );
}
