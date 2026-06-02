import React from "react";
import { Box } from "@mui/material";

export const CodeBlock = React.memo(function CodeBlock({ value }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 2,
        overflow: "auto",
        borderRadius: 1,
        bgcolor: "#101820",
        color: "#d1fae5",
        fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.7
      }}
    >
      {value}
    </Box>
  );
})
