import React, { useState } from "react";
import {
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FeedbackIcon from "@mui/icons-material/Feedback";
import ReplyIcon from "@mui/icons-material/Reply";
import SaveIcon from "@mui/icons-material/Save";
import { Section } from "../components/Section";
import { EmptyState } from "../components/EmptyState";
import { request } from "../utils/api";

export function AdminSuggestionsSection({ suggestions, afterChange, onConfirm, onToast }) {
  const [loadingId, setLoadingId] = useState("");
  const [savingId, setSavingId] = useState("");
  const [replyDialogItem, setReplyDialogItem] = useState(null);
  const [replyDraft, setReplyDraft] = useState("");

  const remove = async (id) => {
    setLoadingId(id);
    try {
      await request(`/api/admin/suggestions/${id}`, { method: "DELETE" });
      await afterChange("建议已删除");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoadingId("");
    }
  };

  const openReplyDialog = (item) => {
    setReplyDialogItem(item);
    setReplyDraft(item.reply || "");
  };

  const closeReplyDialog = () => {
    setReplyDialogItem(null);
    setReplyDraft("");
  };

  const saveReply = async () => {
    if (!replyDialogItem) return;
    const item = replyDialogItem;
    setSavingId(item.id);
    try {
      await request(`/api/admin/suggestions/${item.id}/reply`, {
        method: "PUT",
        body: { reply: replyDraft.trim() }
      });
      closeReplyDialog();
      await afterChange("回复已保存");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setSavingId("");
    }
  };

  return (
    <Section title="用户建议列表" icon={<FeedbackIcon />}>
      {suggestions.length ? (
        <Stack spacing={1.5}>
          {suggestions.map((item) => (
              <Paper
                key={item.id}
                variant="outlined"
                sx={{ p: 2, bgcolor: "app.paperAlt" }}
              >
                <Stack spacing={1.25}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="space-between"
                    flexWrap="wrap"
                  >
                    <Typography variant="subtitle1" sx={{ fontWeight: 780 }}>
                      {item.title}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        {item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : ""}
                      </Typography>
                      <Chip
                        size="small"
                        color={item.reply ? "success" : "default"}
                        variant={item.reply ? "filled" : "outlined"}
                        label={item.reply ? "已回复" : "待回复"}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<ReplyIcon />}
                        onClick={() => openReplyDialog(item)}
                      >
                        {item.reply ? "编辑回复" : "回复"}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        disabled={loadingId === item.id}
                        onClick={() =>
                          onConfirm({
                            title: "删除建议",
                            message: "确认删除这条建议？",
                            confirmText: "删除",
                            danger: true,
                            action: () => remove(item.id)
                          })
                        }
                      >
                        {loadingId === item.id ? (
                          <CircularProgress size={16} />
                        ) : (
                          <DeleteOutlineIcon fontSize="small" />
                        )}
                      </Button>
                    </Stack>
                  </Stack>

                  {item.userName ? (
                    <Typography variant="body2" color="text.secondary">
                      提交用户：{item.userName}
                    </Typography>
                  ) : null}
                  {item.contact ? (
                    <Typography variant="body2" color="text.secondary">
                      联系方式：{item.contact}
                    </Typography>
                  ) : null}

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
                    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "app.successSoft", borderColor: "success.main" }}>
                      <Typography variant="caption" color="text.secondary">
                        管理员回复{item.repliedAt ? ` · ${new Date(item.repliedAt).toLocaleString("zh-CN")}` : ""}
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
                        {item.reply}
                      </Typography>
                    </Paper>
                  ) : null}
                </Stack>
              </Paper>
          ))}
        </Stack>
      ) : (
        <EmptyState text="还没有收到用户建议。" />
      )}

      <Dialog open={Boolean(replyDialogItem)} onClose={closeReplyDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{replyDialogItem?.reply ? "编辑回复" : "回复用户建议"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 780 }}>
              {replyDialogItem?.title}
            </Typography>
            <TextField
              label="管理员回复"
              placeholder="写下给用户看的回复"
              value={replyDraft}
              onChange={(event) => setReplyDraft(event.target.value)}
              multiline
              minRows={5}
              fullWidth
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={closeReplyDialog}>
            取消
          </Button>
          <Button
            variant="contained"
            startIcon={savingId === replyDialogItem?.id ? <CircularProgress size={16} /> : <SaveIcon />}
            disabled={savingId === replyDialogItem?.id}
            onClick={saveReply}
          >
            保存回复
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}
