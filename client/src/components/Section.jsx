import React from "react";
import { Paper, Stack, Box, Typography, Divider } from "@mui/material";

export const Section = React.memo(function Section({ title, icon, action, children }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 1.5, sm: 2 },
        boxShadow: "none",
        transition: "box-shadow 0.2s ease, border-color 0.2s ease",
        "&:hover": {
          borderColor: "app.borderStrong"
        }
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ mb: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box
            sx={{
              color: "text.secondary",
              display: "flex",
              width: 28,
              height: 28,
              borderRadius: 1,
              bgcolor: "app.paperAlt",
              border: "1px solid",
              borderColor: "divider",
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
