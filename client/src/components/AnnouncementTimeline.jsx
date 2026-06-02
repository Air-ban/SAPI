import React from "react";
import {
  Box,
  Chip,
  Paper,
  Stack,
  Typography
} from "@mui/material";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import { formatDate } from "../utils/helpers";

export function AnnouncementTimeline({ announcements }) {
  if (!announcements.length) return null;

  const typeConfig = {
    info: { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", label: "信息" },
    warning: { color: "#d97706", bg: "#fffbeb", border: "#fde68a", label: "警告" },
    success: { color: "#059669", bg: "#ecfdf5", border: "#a7f3d0", label: "成功" },
    error: { color: "#dc2626", bg: "#fef2f2", border: "#fecaca", label: "错误" }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, boxShadow: "0 4px 16px rgba(15, 23, 42, 0.04)" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2.5 }}>
        <CampaignOutlinedIcon sx={{ color: "primary.main" }} />
        <Typography variant="h6" sx={{ fontWeight: 780 }}>公告动态</Typography>
      </Stack>
      <Box sx={{ position: "relative", pl: { xs: 2.5, sm: 3.5 } }}>
        <Box
          sx={{
            position: "absolute",
            left: { xs: 6, sm: 10 },
            top: 6,
            bottom: 6,
            width: 2,
            bgcolor: "divider"
          }}
        />
        <Stack spacing={0}>
          {announcements.map((item, index) => {
            const cfg = typeConfig[item.type] || typeConfig.info;
            const isLast = index === announcements.length - 1;
            return (
              <Box
                key={item.id}
                sx={{
                  position: "relative",
                  pb: isLast ? 0 : 2.5,
                  "&::before": {
                    content: '""',
                    position: "absolute",
                    left: { xs: -2.5, sm: -3.5 },
                    top: 8,
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    bgcolor: cfg.color,
                    border: "2.5px solid",
                    borderColor: "background.paper",
                    boxShadow: `0 0 0 2px ${cfg.color}`,
                    zIndex: 1,
                    transform: "translateX(-0.5px)"
                  }
                }}
              >
                <Paper
                  variant="outlined"
                  sx={{
                    p: { xs: 1.5, sm: 2 },
                    bgcolor: cfg.bg,
                    borderColor: cfg.border,
                    borderRadius: 2,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                    <Chip
                      label={cfg.label}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        bgcolor: cfg.color,
                        color: "#fff",
                        "& .MuiChip-label": { px: 1 }
                      }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(item.createdAt)}
                    </Typography>
                  </Stack>
                  <Typography variant="subtitle2" sx={{ fontWeight: 760, mb: 0.5 }}>
                    {item.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
                    {item.content}
                  </Typography>
                </Paper>
              </Box>
            );
          })}
        </Stack>
      </Box>
    </Paper>
  );
}
