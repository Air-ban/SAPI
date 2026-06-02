import React, { useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import MailIcon from "@mui/icons-material/Mail";
import SendIcon from "@mui/icons-material/Send";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import { Section } from "../components/Section";
import { EmptyState } from "../components/EmptyState";
import { formatDate } from "../utils/helpers";
import { request } from "../utils/api";

export function InvitationCodesSection({ codes, afterChange, onConfirm, onCopy, onToast }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [expiresAtInput, setExpiresAtInput] = useState("");
  const [maxUsesInput, setMaxUsesInput] = useState("");
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [sendForm, setSendForm] = useState({ email: "", codeId: "", customCode: "" });
  const [sendLoading, setSendLoading] = useState(false);

  const createCode = async () => {
    await request("/api/admin/invitation-codes", {
      method: "POST",
      body: {
        code: codeInput,
        note: noteInput,
        expiresAt: expiresAtInput,
        maxUses: maxUsesInput ? Number(maxUsesInput) : 0
      }
    });
    setCodeInput("");
    setNoteInput("");
    setExpiresAtInput("");
    setMaxUsesInput("");
    setCreateOpen(false);
    await afterChange("邀请码已创建");
  };

  const deleteCode = (id, code) => {
    onConfirm({
      title: "删除邀请码",
      message: `确认删除邀请码 ${code}？`,
      confirmText: "删除",
      danger: true,
      action: async () => {
        await request(`/api/admin/invitation-codes/${id}`, { method: "DELETE" });
        await afterChange("邀请码已删除");
      }
    });
  };

  const openSendEmail = (codeId, customCode) => {
    setSendForm({ email: "", codeId: codeId || "", customCode: customCode || "" });
    setSendEmailOpen(true);
  };

  const sendEmail = async () => {
    setSendLoading(true);
    try {
      await request("/api/admin/invitation-codes/send", {
        method: "POST",
        body: sendForm
      });
      setSendEmailOpen(false);
      onToast("邀请邮件已发送，请提醒收件人检查垃圾邮件文件夹", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setSendLoading(false);
    }
  };

  return (
    <>
      <Section
        title="邀请码"
        icon={<VpnKeyIcon />}
        action={
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setCreateOpen(true)}>
            新建邀请码
          </Button>
        }
      >
        {codes.length ? (
          <Stack spacing={1.5}>
            {codes.map((code) => {
              const isExpired = code.expiresAt && new Date(code.expiresAt) < new Date();
              const isMaxed = code.maxUses > 0 && code.usedCount >= code.maxUses;
              const isActive = !isExpired && !isMaxed;
              const usageText = code.maxUses > 0 ? `${code.usedCount || 0} / ${code.maxUses}` : `${code.usedCount || 0} 次`;
              return (
                <Paper
                  key={code.id}
                  variant="outlined"
                  sx={{
                    p: { xs: 1.5, sm: 2 },
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
                    gap: 1.5,
                    alignItems: "center",
                    bgcolor: isActive ? "#fbfcfe" : "action.hover",
                    opacity: isActive ? 1 : 0.85
                  }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                    <Box
                      sx={{
                        width: 38,
                        height: 38,
                        borderRadius: 1,
                        display: "grid",
                        placeItems: "center",
                        bgcolor: isActive ? "rgba(15,118,110,0.1)" : "rgba(120,120,120,0.1)",
                        color: isActive ? "primary.main" : "text.disabled",
                        flexShrink: 0
                      }}
                    >
                      <VpnKeyIcon />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="subtitle1" sx={{ fontWeight: 780, fontFamily: 'Consolas, monospace', overflowWrap: "anywhere" }}>
                          {code.code}
                        </Typography>
                        <Chip
                          size="small"
                          label={isActive ? "有效" : isExpired ? "已过期" : "已达上限"}
                          color={isActive ? "success" : "default"}
                          variant="outlined"
                        />
                        {code.note ? (
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 200 }}>
                            {code.note}
                          </Typography>
                        ) : null}
                      </Stack>
                      <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          已使用 {usageText}
                        </Typography>
                        {code.expiresAt ? (
                          <Typography variant="caption" color={isExpired ? "error" : "text.secondary"}>
                            {isExpired ? "已于 " : ""}{formatDate(code.expiresAt)}{isExpired ? " 过期" : " 过期"}
                          </Typography>
                        ) : null}
                      </Stack>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={{ xs: "flex-start", md: "flex-end" }}>
                    <Tooltip title="复制邀请码">
                      <IconButton size="small" onClick={() => onCopy(code.code)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="发送邀请邮件">
                      <IconButton size="small" onClick={() => openSendEmail(code.id, code.code)}>
                        <MailIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除">
                      <IconButton size="small" color="error" onClick={() => deleteCode(code.id, code.code)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        ) : (
          <EmptyState text="还没有创建邀请码。创建后用户注册时需要输入有效的邀请码。" />
        )}
      </Section>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth PaperProps={{ component: "form", onSubmit: (e) => { e.preventDefault(); createCode().catch((err) => onToast(err.message, "error")); } }}>
        <DialogTitle>新建邀请码</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="自定义邀请码"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="留空则自动生成"
              helperText="4-64 个字符，仅允许字母、数字、下划线和短横线。"
            />
            <TextField
              label="备注"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="例如：团队 A 专用"
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                type="datetime-local"
                label="过期时间"
                InputLabelProps={{ shrink: true }}
                value={expiresAtInput}
                onChange={(e) => setExpiresAtInput(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                type="number"
                label="最大使用次数"
                value={maxUsesInput}
                onChange={(e) => setMaxUsesInput(e.target.value)}
                placeholder="0 表示无限制"
                sx={{ flex: 1 }}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} color="inherit">取消</Button>
          <Button type="submit" variant="contained" startIcon={<AddIcon />}>创建</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={sendEmailOpen} onClose={() => setSendEmailOpen(false)} maxWidth="sm" fullWidth PaperProps={{ component: "form", onSubmit: (e) => { e.preventDefault(); sendEmail().catch((err) => onToast(err.message, "error")); } }}>
        <DialogTitle>发送邀请邮件</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'rgba(15,118,110,0.04)', display: 'flex', alignItems: 'center', gap: 1 }}>
              <VpnKeyIcon fontSize="small" color="action" />
              <Typography variant="body2" sx={{ fontFamily: 'Consolas, monospace', fontWeight: 700 }}>
                {sendForm.customCode}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                将使用此邀请码发送
              </Typography>
            </Paper>
            <TextField
              label="收件人邮箱"
              value={sendForm.email}
              onChange={(e) => setSendForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="user@example.com"
              required
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSendEmailOpen(false)} color="inherit">取消</Button>
          <Button type="submit" variant="contained" disabled={sendLoading} startIcon={sendLoading ? <CircularProgress size={16} /> : <SendIcon />}>
            发送
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
