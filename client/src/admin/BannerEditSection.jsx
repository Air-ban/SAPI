import React, { useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import SaveIcon from "@mui/icons-material/Save";
import { Section } from "../components/Section";
import { formatDate } from "../utils/helpers";
import { request } from "../utils/api";

export function BannerEditSection({ banner, afterChange, onToast }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setContent(banner?.content || "");
  }, [banner]);

  const save = async () => {
    setLoading(true);
    try {
      await request("/api/admin/banner", {
        method: "PUT",
        body: { content }
      });
      await afterChange("站点横幅已保存");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="站点横幅" icon={<CampaignOutlinedIcon />}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          设置站点顶部横幅内容，将在用户端页面顶部显示。留空则不显示横幅。
        </Typography>
        <TextField
          label="横幅内容"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="输入横幅内容..."
          multiline
          rows={3}
          fullWidth
        />
        {banner?.updatedAt ? (
          <Typography variant="caption" color="text.secondary">
            上次更新：{formatDate(banner.updatedAt)}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1.5} justifyContent="flex-end">
          <Button
            variant="contained"
            onClick={() => save().catch((e) => onToast(e.message, "error"))}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={16} /> : <SaveIcon />}
          >
            保存横幅
          </Button>
        </Stack>
      </Stack>
    </Section>
  );
}
