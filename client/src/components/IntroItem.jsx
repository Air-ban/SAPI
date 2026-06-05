import React from "react";
import { Paper, Stack, Box, Typography } from "@mui/material";

export const IntroItem = React.memo(function IntroItem({ icon, title, text }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: "100%",
        transition: "border-color 0.15s ease",
        cursor: "default",
        "&:hover": {
          borderColor: "app.borderStrong"
        }
      }}
    >
      <Stack spacing={1.5}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1,
            display: "grid",
            placeItems: "center",
            bgcolor: "app.paperAlt",
            border: "1px solid",
            borderColor: "divider",
            color: "primary.main",
            "& svg": { fontSize: 20 }
          }}
        >
          {icon}
        </Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 620 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
          {text}
        </Typography>
      </Stack>
    </Paper>
  );
});
