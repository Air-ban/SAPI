import React from "react";
import { Box } from "@mui/material";

export const DividerLine = React.memo(function DividerLine() {
  return <Box sx={{ height: 1, bgcolor: "divider", width: "100%" }} />;
})
