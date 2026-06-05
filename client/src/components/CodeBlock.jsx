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
        bgcolor: "app.codeBg",
        color: "app.codeText",
        border: "1px solid",
        borderColor: "app.borderStrong",
        fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.7
      }}
    >
      {value}
    </Box>
  );
})
