import React from "react";
import { Alert } from "@mui/material";

export const EmptyState = React.memo(function EmptyState({ text }) {
  return (
    <Alert
      severity="info"
      variant="outlined"
      sx={{
        borderColor: "app.glassBorder",
        background: (theme) => theme.palette.app.glass,
        boxShadow: (theme) => theme.palette.app.softShadow,
        "& .MuiAlert-icon": {
          color: "app.accentCyan"
        }
      }}
    >
      {text}
    </Alert>
  );
})
