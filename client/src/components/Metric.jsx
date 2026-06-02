import React from "react";
import { Paper, Stack, Box, Typography } from "@mui/material";

export const Metric = React.memo(function Metric({ icon, label, value }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        minWidth: 0,
        cursor: "default",
        transition: "all 0.2s ease",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: "0 8px 25px rgba(0,0,0,0.08)",
          borderColor: "primary.light"
        }
      }}
    >
      <Stack direction="row" spacing={1.4} alignItems="center">
        <Box
          sx={{
            width: 44,
            height: 44,
            display: "grid",
            placeItems: "center",
            borderRadius: 2,
            background: "linear-gradient(135deg, rgba(13,115,119,0.12) 0%, rgba(59,89,152,0.08) 100%)",
            color: "secondary.main",
            flexShrink: 0,
            transition: "transform 0.2s ease",
            ".MuiPaper-root:hover &": {
              transform: "scale(1.05)"
            }
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
            {label}
          </Typography>
          <Typography variant="h6" noWrap title={String(value)} sx={{ fontWeight: 680 }}>
            {value}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
});
