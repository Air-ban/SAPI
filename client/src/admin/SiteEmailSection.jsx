import React, { useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import MailIcon from "@mui/icons-material/Mail";
import SaveIcon from "@mui/icons-material/Save";
import { Section } from "../components/Section";
import { request } from "../utils/api";

export function SiteEmailSection({ afterChange, onToast }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    request("/api/admin/site-email")
      .then((data) => setEmail(data.siteEmail || ""))
      .catch(() => {});
  }, []);

  const save = async () => {
    setLoading(true);
    try {
      await request("/api/admin/site-email", {
        method: "PUT",
        body: { siteEmail: email.trim() }
      });
      await afterChange("站长邮箱已保存");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="站长邮箱" icon={<MailIcon />}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          设置站长邮箱后，当用户提交建议时，系统会自动发送邮件通知到该邮箱。
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "flex-start" }}>
          <TextField
            label="站长邮箱地址"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
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
