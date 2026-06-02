import React from "react";
import { Paper, Stack, Box, Typography } from "@mui/material";

export const IntroItem = React.memo(function IntroItem({ icon, title, text }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        height: "100%",
        transition: "all 0.2s ease",
        cursor: "default",
        "&:hover": {
          transform: "translateY(-3px)",
          boxShadow: "0 12px 30px rgba(0,0,0,0.08)",
          borderColor: "primary.light"
        }
      }}
    >
      <Stack spacing={1.5}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg, rgba(13,115,119,0.12), rgba(59,89,152,0.08))",
            color: "primary.main",
            transition: "transform 0.2s ease",
            ".MuiPaper-root:hover &": {
              transform: "scale(1.08)"
            }
          }}
        >
          {icon}
        </Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 720 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
          {text}
        </Typography>
      </Stack>
    </Paper>
  );
});
