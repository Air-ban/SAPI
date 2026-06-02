import React from "react";
import { Box, CircularProgress, Stack, Typography } from "@mui/material";

export const LoadingPage = React.memo(function LoadingPage({ text }) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        px: 2
      }}
    >
      <Stack spacing={2.5} alignItems="center">
        <CircularProgress size={40} thickness={4} />
        <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>
          {text || "加载中"}
        </Typography>
      </Stack>
    </Box>
  );
});
