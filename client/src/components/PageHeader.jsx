import React from "react";
import { Stack, Box, Typography } from "@mui/material";

export const PageHeader = React.memo(function PageHeader({ eyebrow, title, description, action }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      alignItems={{ xs: "stretch", sm: "flex-start" }}
      justifyContent="space-between"
      sx={{
        position: "sticky",
        top: { xs: 64, md: 0 },
        zIndex: 5,
        mx: { xs: -0.5, sm: -1 },
        px: { xs: 0.5, sm: 1 },
        py: 1,
        bgcolor: "background.default",
        borderBottom: "1px solid",
        borderColor: "divider"
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 560 }}>
          {eyebrow}
        </Typography>
        <Typography variant="h4" component="h1" sx={{ mt: 0.4 }}>
          {title}
        </Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 720 }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
    </Stack>
  );
})
