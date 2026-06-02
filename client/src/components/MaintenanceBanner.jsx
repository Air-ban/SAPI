import React from "react";
import { Alert, Typography } from "@mui/material";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";

export const MaintenanceBanner = React.memo(function MaintenanceBanner({ maintenance }) {
  const endTimeStr = maintenance.maintenanceEndTime
    ? `预计 ${new Date(maintenance.maintenanceEndTime).toLocaleString("zh-CN")} 恢复`
    : "恢复时间待定";

  return (
    <Alert
      severity="warning"
      icon={<CampaignOutlinedIcon />}
      sx={{ mb: 2.5, "& .MuiAlert-message": { flex: 1 } }}
    >
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        站点维护中
      </Typography>
      <Typography variant="body2">
        {endTimeStr}，在此期间所有 API 请求将暂时中断。如有紧急需求请联系管理员。
      </Typography>
    </Alert>
  );
})
