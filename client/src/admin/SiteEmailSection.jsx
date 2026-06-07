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

function splitEmails(value) {
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SiteEmailSection({ afterChange, onToast }) {
  const [emailText, setEmailText] = useState("");
  const [loading, setLoading] = useState(false);
  const emails = splitEmails(emailText);

  useEffect(() => {
    request("/api/admin/site-email")
      .then((data) => {
        const list = Array.isArray(data.siteEmails) ? data.siteEmails : [];
        setEmailText(list.length ? list.join("\n") : (data.siteEmail || ""));
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setLoading(true);
    try {
      await request("/api/admin/site-email", {
        method: "PUT",
        body: { siteEmails: emails }
      });
      await afterChange(`站长邮箱已保存，共 ${emails.length} 个收件人`);
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
          用户提交建议时，系统会把邮件通知发送给下面所有邮箱。每行填写一个邮箱，也可以用逗号分隔。
        </Typography>
        <Stack spacing={1.5}>
          <TextField
            label="站长邮箱地址"
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            placeholder={"admin@example.com\nops@example.com"}
            helperText={emails.length ? `将通知 ${emails.length} 个邮箱` : "留空则不发送建议反馈邮件通知。"}
            multiline
            minRows={3}
            fullWidth
          />
          <Stack direction="row" justifyContent="flex-end">
            <Button
              variant="contained"
              onClick={() => save().catch((e) => onToast(e.message, "error"))}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : <SaveIcon />}
            >
              保存邮箱
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Section>
  );
}
