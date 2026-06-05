import React from "react";
import { Paper, Stack, Box, Typography } from "@mui/material";

export const Metric = React.memo(function Metric({ icon, label, value }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        minWidth: 0,
        cursor: "default",
        transition: "border-color 0.15s ease",
        "&:hover": {
          borderColor: "app.borderStrong"
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
            bgcolor: "app.paperAlt",
            border: "1px solid",
            borderColor: "divider",
            color: "primary.main",
            flexShrink: 0,
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
