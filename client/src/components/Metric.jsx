import React from "react";
import { Paper, Stack, Box, Typography } from "@mui/material";

export const Metric = React.memo(function Metric({ icon, label, value }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        minWidth: 0,
        position: "relative",
        overflow: "hidden",
        cursor: "default",
        background: (theme) => theme.palette.app.glass,
        borderColor: "app.glassBorder",
        boxShadow: (theme) => theme.palette.app.softShadow,
        transition:
          "transform 0.22s cubic-bezier(.2,.8,.2,1), border-color 0.2s ease, box-shadow 0.2s ease",
        "&::after": {
          content: '""',
          position: "absolute",
          inset: "auto 0 0 0",
          height: 3,
          background: (theme) => theme.palette.app.accentGradient,
          opacity: 0.74
        },
        "&:hover": {
          transform: "translateY(-2px)",
          borderColor: "app.borderStrong",
          boxShadow: (theme) => theme.palette.app.shadow
        },
        "@media (prefers-reduced-motion: reduce)": {
          "&:hover": {
            transform: "none"
          }
        }
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Box
          sx={{
            width: 34,
            height: 34,
            display: "grid",
            placeItems: "center",
            borderRadius: 1,
            bgcolor: "app.primarySoft",
            border: "1px solid",
            borderColor: "app.glassBorder",
            color: "primary.main",
            flexShrink: 0,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.42)",
            "& svg": { fontSize: 18 }
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 520 }}>
            {label}
          </Typography>
          <Typography variant="subtitle1" noWrap title={String(value)} sx={{ fontWeight: 640 }}>
            {value}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
});
