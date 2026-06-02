import React from "react";
import { Paper, Stack, Box, Typography, Chip } from "@mui/material";

export const EntityRow = React.memo(function EntityRow({ title, enabled, icon, meta, actions, failoverChip }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 1.5, sm: 2 },
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) auto" },
        gap: 1.5,
        alignItems: "center",
        bgcolor: "#fafbfc",
        transition: "all 0.15s ease",
        "&:hover": {
          bgcolor: "#f5f7fa",
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          borderColor: "#cbd5e1"
        }
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1.5,
            display: "grid",
            placeItems: "center",
            bgcolor: "rgba(13,115,119,0.09)",
            color: "primary.main",
            flexShrink: 0
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 0.25 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
              {title}
            </Typography>
            <Chip
              size="small"
              label={enabled ? "启用" : "停用"}
              color={enabled ? "success" : "warning"}
              variant="outlined"
              sx={{ fontWeight: 650 }}
            />
            {failoverChip ? (
              <Chip
                size="small"
                label={failoverChip.label}
                color={failoverChip.color}
                variant="outlined"
                sx={{ fontWeight: 650 }}
              />
            ) : null}
          </Stack>
          <Stack spacing={0.3}>
            {meta.map(([label, value]) => (
              <Typography key={label} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                <Box component="span" sx={{ fontWeight: 600, color: "text.primary", mr: 0.3 }}>{label}</Box>
                {value}
              </Typography>
            ))}
          </Stack>
        </Box>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center" justifyContent={{ xs: "flex-start", md: "flex-end" }}>
        {actions}
      </Stack>
    </Paper>
  );
});
