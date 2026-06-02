import React from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography
} from "@mui/material";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";

export function AnnouncementDialog({ announcement, onDismiss }) {
  if (!announcement) return null;

  const severityMap = {
    info: "info",
    warning: "warning",
    success: "success",
    error: "error"
  };
  const severity = severityMap[announcement.type] || "info";

  return (
    <Dialog open={Boolean(announcement)} onClose={onDismiss} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <CampaignOutlinedIcon color={severity} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 780 }}>
            {announcement.title}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Alert severity={severity} variant="outlined" sx={{ whiteSpace: "pre-wrap" }}>
          {announcement.content}
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDismiss} variant="contained">知道了</Button>
      </DialogActions>
    </Dialog>
  );
}
