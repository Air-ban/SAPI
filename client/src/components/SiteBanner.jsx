import React from "react";
import { Alert, Typography } from "@mui/material";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import { formatDate } from "../utils/helpers";

export const SiteBanner = React.memo(function SiteBanner({ banner }) {
  if (!banner || !banner.content) return null;
  return (
    <Alert
      severity="info"
      icon={<CampaignOutlinedIcon />}
      sx={{ mb: 2.5, "& .MuiAlert-message": { flex: 1 } }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {banner.content}
      </Typography>
      {banner.updatedAt ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          更新于 {formatDate(banner.updatedAt)}
        </Typography>
      ) : null}
    </Alert>
  );
})
