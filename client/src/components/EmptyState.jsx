import React from "react";
import { Alert } from "@mui/material";

export const EmptyState = React.memo(function EmptyState({ text }) {
  return (
    <Alert severity="info" variant="outlined">
      {text}
    </Alert>
  );
})
