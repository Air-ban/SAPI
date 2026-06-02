import React from "react";
import { Box } from "@mui/material";
import { marked } from "marked";

export function MarkdownContent({ content }) {
  const html = marked.parse(content || "");
  return (
    <Box
      className="markdown-body"
      sx={{
        "& h1": { fontSize: "1.75rem", fontWeight: 780, mt: 3, mb: 1.5, pb: 0.75, borderBottom: "1px solid", borderColor: "divider" },
        "& h2": { fontSize: "1.4rem", fontWeight: 740, mt: 2.5, mb: 1.25, pb: 0.5, borderBottom: "1px solid", borderColor: "divider" },
        "& h3": { fontSize: "1.15rem", fontWeight: 720, mt: 2, mb: 1 },
        "& h4, & h5, & h6": { fontSize: "1rem", fontWeight: 700, mt: 1.5, mb: 0.75 },
        "& p": { lineHeight: 1.8, mb: 1.25 },
        "& ul, & ol": { pl: 3, mb: 1.25 },
        "& li": { mb: 0.5, lineHeight: 1.7 },
        "& code": {
          fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
          fontSize: "0.88em",
          bgcolor: "rgba(15,23,42,0.06)",
          px: 0.5,
          py: 0.15,
          borderRadius: 0.75
        },
        "& pre": {
          bgcolor: "#101820",
          color: "#d1fae5",
          p: 2,
          borderRadius: 1,
          overflow: "auto",
          fontSize: 13,
          lineHeight: 1.7,
          mb: 1.5,
          "& code": {
            bgcolor: "transparent",
            color: "inherit",
            px: 0,
            py: 0,
            fontSize: "inherit"
          }
        },
        "& blockquote": {
          borderLeft: "4px solid",
          borderColor: "primary.main",
          pl: 2,
          py: 0.5,
          my: 1.5,
          bgcolor: "rgba(15,118,110,0.04)",
          borderRadius: "0 8px 8px 0"
        },
        "& a": { color: "primary.main", textDecoration: "none", "&:hover": { textDecoration: "underline" } },
        "& table": { width: "100%", borderCollapse: "collapse", mb: 1.5 },
        "& th, & td": { border: "1px solid", borderColor: "divider", p: 1, textAlign: "left" },
        "& th": { bgcolor: "rgba(15,23,42,0.04)", fontWeight: 700 },
        "& img": { maxWidth: "100%", borderRadius: 1 },
        "& hr": { border: 0, borderTop: "1px solid", borderColor: "divider", my: 2 }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
