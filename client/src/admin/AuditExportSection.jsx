import React, { useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip
} from "@mui/material";
import DataObjectIcon from "@mui/icons-material/DataObject";
import DownloadIcon from "@mui/icons-material/Download";
import PublicIcon from "@mui/icons-material/Public";
import SecurityIcon from "@mui/icons-material/Security";
import { Section } from "../components/Section";
import { requestBlob } from "../utils/api";

const DAY_OPTIONS = [1, 3, 7];
const LIMIT_OPTIONS = [5000, 20000, 50000, 100000];

export function AuditExportSection({ onToast }) {
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState(20000);
  const [loading, setLoading] = useState("");

  const download = async (mode) => {
    const includeContent = mode === "content";
    setLoading(mode);
    try {
      const params = new URLSearchParams({
        days: String(days),
        limit: String(limit),
        includeContent: includeContent ? "true" : "false"
      });
      const { blob, filename } = await requestBlob(`/api/admin/request-logs/export?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || (includeContent ? "sapi-request-content.tar.gz" : "sapi-request-ip-device.tar.gz");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onToast?.(includeContent ? "详细请求体已导出" : "IP 与设备信息已导出", "success");
    } catch (error) {
      onToast?.(error.message, "error");
    } finally {
      setLoading("");
    }
  };

  return (
    <Section
      title="审计导出"
      icon={<SecurityIcon />}
      action={
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ minWidth: { xs: 0, sm: 268 } }}>
          <TextField
            select
            size="small"
            label="范围"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            sx={{ minWidth: 96 }}
          >
            {DAY_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>
                {option} 天
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="上限"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            sx={{ minWidth: 112 }}
          >
            {LIMIT_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      }
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
          gap: 1.25
        }}
      >
        <Tooltip title="导出 requestContent JSON">
          <Box component="span" sx={{ display: "block", minWidth: 0 }}>
            <Button
              fullWidth
              variant="contained"
              startIcon={loading === "content" ? <CircularProgress size={16} /> : <DataObjectIcon />}
              onClick={() => download("content")}
              disabled={Boolean(loading)}
              sx={{ justifyContent: "flex-start", minHeight: 44 }}
            >
              导出详细请求体
            </Button>
          </Box>
        </Tooltip>
        <Tooltip title="导出 clientIpInfo 与 clientDevice">
          <Box component="span" sx={{ display: "block", minWidth: 0 }}>
            <Button
              fullWidth
              variant="outlined"
              startIcon={loading === "identity" ? <CircularProgress size={16} /> : <PublicIcon />}
              endIcon={loading ? null : <DownloadIcon />}
              onClick={() => download("identity")}
              disabled={Boolean(loading)}
              sx={{ justifyContent: "flex-start", minHeight: 44 }}
            >
              导出 IP 与设备信息
            </Button>
          </Box>
        </Tooltip>
      </Box>
    </Section>
  );
}
