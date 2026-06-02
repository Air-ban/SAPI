import React, { useState } from "react";
import {
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField
} from "@mui/material";
import FeedbackIcon from "@mui/icons-material/Feedback";
import SendIcon from "@mui/icons-material/Send";
import { Section } from "../components/Section";
import { request } from "../utils/api";

export function UserSuggestionSection({ onToast }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      onToast("请输入标题", "warning");
      return;
    }
    if (!content.trim()) {
      onToast("请输入内容", "warning");
      return;
    }
    setLoading(true);
    try {
      await request("/api/suggestions", {
        method: "POST",
        admin: false,
        body: { title: title.trim(), content: content.trim(), contact: contact.trim() }
      });
      onToast("建议已提交，感谢你的反馈！", "success");
      setTitle("");
      setContent("");
      setContact("");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="提交建议" icon={<FeedbackIcon />}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5}>
          <TextField
            label="标题"
            placeholder="简要描述你的建议"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
          />
          <TextField
            label="详细内容"
            placeholder="请详细描述你的建议或遇到的问题"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            multiline
            rows={6}
            fullWidth
          />
          <TextField
            label="联系方式（选填）"
            placeholder="邮箱或其他联系方式，方便我们回复你"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            fullWidth
          />
          <Stack direction="row" spacing={1.5} justifyContent="flex-end">
            <Button
              variant="contained"
              onClick={submit}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : <SendIcon />}
            >
              提交建议
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Section>
  );
}
