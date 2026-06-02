import React from "react";
import { Stack, Box, Typography } from "@mui/material";

export const PageHeader = React.memo(function PageHeader({ eyebrow, title, description, action }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      alignItems={{ xs: "stretch", sm: "flex-start" }}
      justifyContent="space-between"
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="overline" color="primary" sx={{ fontWeight: 850 }}>
          {eyebrow}
        </Typography>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {description ? (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.7, maxWidth: 720 }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
    </Stack>
  );
})
