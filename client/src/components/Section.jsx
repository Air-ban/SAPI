import React from "react";
import { Paper, Stack, Box, Typography, Divider } from "@mui/material";

export const Section = React.memo(function Section({ title, icon, action, children }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 1.5, sm: 2 },
        position: "relative",
        overflow: "hidden",
        bgcolor: "transparent",
        background: (theme) => theme.palette.app.glass,
        borderColor: "app.glassBorder",
        boxShadow: (theme) => theme.palette.app.softShadow,
        transition:
          "transform 0.22s cubic-bezier(.2,.8,.2,1), box-shadow 0.22s ease, border-color 0.22s ease",
        "&::before": {
          content: '""',
          position: "absolute",
          inset: "0 0 auto 0",
          height: 1,
          bgcolor: "app.glassEdge",
          opacity: 0.8,
          pointerEvents: "none"
        },
        "&:hover": {
          transform: "translateY(-1px)",
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
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ mb: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box
            sx={{
              color: "primary.main",
              display: "flex",
              width: 28,
              height: 28,
              borderRadius: 1,
              bgcolor: "app.primarySoft",
              border: "1px solid",
              borderColor: "app.glassBorder",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.42)",
              alignItems: "center",
              justifyContent: "center",
              "& svg": { fontSize: 17 }
            }}
          >
            {icon}
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 620 }}>
            {title}
          </Typography>
        </Stack>
        {action}
      </Stack>
      <Divider sx={{ mb: 2 }} />
      {children}
    </Paper>
  );
});
