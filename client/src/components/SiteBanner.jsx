import React from "react";
import { Alert, Link, Typography } from "@mui/material";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import { formatDate } from "../utils/helpers";

function renderBannerContent(content) {
  const nodes = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }
    nodes.push(
      <Link
        key={`${match[2]}-${match.index}`}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        color="inherit"
        sx={{ fontWeight: 800, textDecorationColor: "currentColor" }}
      >
        {match[1]}
      </Link>
    );
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes.length ? nodes : content;
}

export const SiteBanner = React.memo(function SiteBanner({ banner }) {
  if (!banner || !banner.content) return null;
  return (
    <Alert
      severity="info"
      icon={<CampaignOutlinedIcon />}
      sx={{ mb: 2.5, "& .MuiAlert-message": { flex: 1 } }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {renderBannerContent(banner.content)}
      </Typography>
      {banner.updatedAt ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          更新于 {formatDate(banner.updatedAt)}
        </Typography>
      ) : null}
    </Alert>
  );
})
