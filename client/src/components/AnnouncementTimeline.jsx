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
    info: { color: "primary.main", bg: "app.primarySoft", border: "primary.main", chipColor: "primary", label: "信息" },
    warning: { color: "warning.main", bg: "app.warningSoft", border: "warning.main", chipColor: "warning", label: "警告" },
    success: { color: "success.main", bg: "app.successSoft", border: "success.main", chipColor: "success", label: "成功" },
    error: { color: "error.main", bg: "app.errorSoft", border: "error.main", chipColor: "error", label: "错误" }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, boxShadow: (theme) => theme.palette.app.shadow }}>
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
                    boxShadow: (theme) => {
                      const [paletteName] = cfg.color.split(".");
                      const color = theme.palette[paletteName]?.main || theme.palette.primary.main;
                      return `0 0 0 2px ${color}`;
                    },
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
                    color: "text.primary"
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                    <Chip
                      label={cfg.label}
                      size="small"
                      color={cfg.chipColor}
                      variant="filled"
                      sx={{
                        height: 20,
                        fontSize: "0.7rem",
                        fontWeight: 700,
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
