import React, { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import FeedbackIcon from "@mui/icons-material/Feedback";
import ReplyIcon from "@mui/icons-material/Reply";
import SendIcon from "@mui/icons-material/Send";
import { EmptyState } from "../components/EmptyState";
import { Section } from "../components/Section";
import { USER_TOKEN_KEY } from "../constants";
import { request } from "../utils/api";

export function UserSuggestionSection({ onToast }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const loadSuggestions = useCallback(async () => {
    const token = localStorage.getItem(USER_TOKEN_KEY);
    if (!token) {
      setSuggestions([]);
      return;
    }

    setLoadingList(true);
    try {
      const data = await request("/api/user/suggestions", { admin: false, token });
      setSuggestions(data?.suggestions || []);
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoadingList(false);
    }
  }, [onToast]);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const submit = async () => {
    if (!title.trim()) {
      onToast("请输入标题", "warning");
      return;
    }
    if (!content.trim()) {
      onToast("请输入内容", "warning");
      return;
    }

    const token = localStorage.getItem(USER_TOKEN_KEY);
    setLoading(true);
    try {
      await request("/api/suggestions", {
        method: "POST",
        admin: false,
        token,
        body: { title: title.trim(), content: content.trim(), contact: contact.trim() }
      });
      onToast("建议已提交，感谢你的反馈！", "success");
      setTitle("");
      setContent("");
      setContact("");
      await loadSuggestions();
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack spacing={2.5}>
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

      <Section
        title="我的建议"
        icon={<ReplyIcon />}
        action={
          <Button size="small" variant="outlined" onClick={loadSuggestions} disabled={loadingList}>
            {loadingList ? "刷新中" : "刷新"}
          </Button>
        }
      >
        {suggestions.length ? (
          <Stack spacing={1.5}>
            {suggestions.map((item) => (
              <Paper key={item.id} variant="outlined" sx={{ p: 2, bgcolor: "#fbfcfe" }}>
                <Stack spacing={1.25}>
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap">
                    <Typography variant="subtitle1" sx={{ fontWeight: 780 }}>
                      {item.title}
                    </Typography>
                    <Chip
                      size="small"
                      color={item.reply ? "success" : "default"}
                      variant={item.reply ? "filled" : "outlined"}
                      label={item.reply ? "已回复" : "待回复"}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : ""}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      whiteSpace: "pre-wrap",
                      bgcolor: "background.default",
                      p: 1.5,
                      borderRadius: 1
                    }}
                  >
                    {item.content}
                  </Typography>
                  {item.reply ? (
                    <Box
                      sx={{
                        border: "1px solid",
                        borderColor: "success.light",
                        bgcolor: "rgba(16,185,129,0.08)",
                        borderRadius: 1,
                        p: 1.5
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        管理员回复{item.repliedAt ? ` · ${new Date(item.repliedAt).toLocaleString("zh-CN")}` : ""}
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
                        {item.reply}
                      </Typography>
                    </Box>
                  ) : null}
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <EmptyState text={loadingList ? "正在加载建议记录..." : "你还没有提交过建议。"} />
        )}
      </Section>
    </Stack>
  );
}
