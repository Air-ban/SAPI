import React, { useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import MailIcon from "@mui/icons-material/Mail";
import { Section } from "../components/Section";
import { EmptyState } from "../components/EmptyState";
import { formatDate } from "../utils/helpers";
import { request } from "../utils/api";

export function AnnouncementsSection({ announcements, afterChange, onConfirm, onToast }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: "", content: "", type: "info", sendEmail: false });

  const resetForm = () => setForm({ title: "", content: "", type: "info", sendEmail: false });

  const createAnnouncement = async () => {
    await request("/api/admin/announcements", {
      method: "POST",
      body: form
    });
    resetForm();
    setCreateOpen(false);
    await afterChange("公告已发布，邮件通知已发送");
  };

  const updateAnnouncement = async () => {
    if (!editing) return;
    await request(`/api/admin/announcements/${editing.id}`, {
      method: "PUT",
      body: form
    });
    setEditOpen(false);
    setEditing(null);
    await afterChange("公告已更新");
  };

  const deleteAnnouncement = (id, title) => {
    onConfirm({
      title: "删除公告",
      message: `确认删除公告 "${title}"？`,
      confirmText: "删除",
      danger: true,
      action: async () => {
        await request(`/api/admin/announcements/${id}`, { method: "DELETE" });
        await afterChange("公告已删除");
      }
    });
  };

  const toggleEnabled = async (item) => {
    try {
      await request(`/api/admin/announcements/${item.id}`, {
        method: "PUT",
        body: { enabled: !item.enabled }
      });
      await afterChange(item.enabled ? "公告已停用" : "公告已启用");
    } catch (error) {
      onToast(error.message, "error");
    }
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({ title: item.title, content: item.content, type: item.type || "info", sendEmail: item.sendEmail === true });
    setEditOpen(true);
  };

  const typeColor = (type) => {
    if (type === "warning") return "warning";
    if (type === "error") return "error";
    if (type === "success") return "success";
    return "info";
  };

  const typeLabel = (type) => {
    if (type === "warning") return "警告";
    if (type === "error") return "错误";
    if (type === "success") return "成功";
    return "信息";
  };

  return (
    <>
      <Section
        title="系统公告"
        icon={<CampaignOutlinedIcon />}
        action={
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => { resetForm(); setCreateOpen(true); }}>
            发布公告
          </Button>
        }
      >
        {announcements.length ? (
          <Stack spacing={1.5}>
            {announcements.map((item) => (
              <Paper
                key={item.id}
                variant="outlined"
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
                  gap: 1.5,
                  alignItems: "center",
                  bgcolor: item.enabled !== false ? "app.paperAlt" : "action.hover",
                  opacity: item.enabled !== false ? 1 : 0.85
                }}
              >
                <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="subtitle1" sx={{ fontWeight: 780 }}>
                      {item.title}
                    </Typography>
                    <Chip size="small" label={typeLabel(item.type)} color={typeColor(item.type)} variant="outlined" />
                    <Chip
                      size="small"
                      label={item.enabled !== false ? "已启用" : "已停用"}
                      color={item.enabled !== false ? "success" : "default"}
                      variant="outlined"
                    />
                    {item.sendEmail === true ? (
                      <Chip size="small" label="邮件通知" color="primary" variant="outlined" icon={<MailIcon fontSize="small" />} />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                    {item.content}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    更新于 {formatDate(item.updatedAt || item.createdAt)}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={{ xs: "flex-start", md: "flex-end" }}>
                  <Tooltip title={item.enabled !== false ? "停用" : "启用"}>
                    <IconButton size="small" onClick={() => toggleEnabled(item)}>
                      {item.enabled !== false ? <CheckCircleIcon fontSize="small" color="success" /> : <CheckCircleIcon fontSize="small" color="disabled" />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="编辑">
                    <IconButton size="small" onClick={() => openEdit(item)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="删除">
                    <IconButton size="small" color="error" onClick={() => deleteAnnouncement(item.id, item.title)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <EmptyState text="还没有发布公告。发布公告后，用户端将以弹窗卡片的形式展示。" />
        )}
      </Section>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth PaperProps={{ component: "form", onSubmit: (e) => { e.preventDefault(); createAnnouncement().catch((err) => onToast(err.message, "error")); } }}>
        <DialogTitle>发布公告</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="标题"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="公告标题"
              required
              autoFocus
            />
            <TextField
              label="内容"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="公告内容"
              multiline
              rows={4}
              required
            />
            <FormControl fullWidth>
              <InputLabel id="ann-type-label">类型</InputLabel>
              <Select
                labelId="ann-type-label"
                value={form.type}
                label="类型"
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                <MenuItem value="info">信息</MenuItem>
                <MenuItem value="warning">警告</MenuItem>
                <MenuItem value="success">成功</MenuItem>
                <MenuItem value="error">错误</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={form.sendEmail}
                  onChange={(e) => setForm((f) => ({ ...f, sendEmail: e.target.checked }))}
                />
              }
              label="同时发送邮件通知给用户"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} color="inherit">取消</Button>
          <Button type="submit" variant="contained" startIcon={<AddIcon />}>发布</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editOpen} onClose={() => { setEditOpen(false); setEditing(null); }} maxWidth="sm" fullWidth PaperProps={{ component: "form", onSubmit: (e) => { e.preventDefault(); updateAnnouncement().catch((err) => onToast(err.message, "error")); } }}>
        <DialogTitle>编辑公告</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="标题"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
            <TextField
              label="内容"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              multiline
              rows={4}
              required
            />
            <FormControl fullWidth>
              <InputLabel id="ann-edit-type-label">类型</InputLabel>
              <Select
                labelId="ann-edit-type-label"
                value={form.type}
                label="类型"
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                <MenuItem value="info">信息</MenuItem>
                <MenuItem value="warning">警告</MenuItem>
                <MenuItem value="success">成功</MenuItem>
                <MenuItem value="error">错误</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={form.sendEmail}
                  onChange={(e) => setForm((f) => ({ ...f, sendEmail: e.target.checked }))}
                />
              }
              label="同时发送邮件通知给用户"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditOpen(false); setEditing(null); }} color="inherit">取消</Button>
          <Button type="submit" variant="contained" startIcon={<EditIcon />}>更新</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
