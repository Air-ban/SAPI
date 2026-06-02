import React from "react";
import { Paper, Stack, Box, Typography, Divider } from "@mui/material";

export const Section = React.memo(function Section({ title, icon, action, children }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 1.75, sm: 2.25 },
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
        transition: "box-shadow 0.2s ease, border-color 0.2s ease",
        "&:hover": {
          borderColor: "#cbd5e1",
          boxShadow: "0 4px 12px rgba(15, 23, 42, 0.06)"
        }
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ mb: 1.75 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box
            sx={{
              color: "primary.main",
              display: "flex",
              width: 32,
              height: 32,
              borderRadius: 1.5,
              bgcolor: "rgba(13,115,119,0.08)",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            {icon}
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 680 }}>
            {title}
          </Typography>
        </Stack>
        {action}
      </Stack>
      <Divider sx={{ mb: 2, borderColor: "#f1f5f9" }} />
      {children}
    </Paper>
  );
});
