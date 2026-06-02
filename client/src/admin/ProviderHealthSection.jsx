import React from "react";
import { Box } from "@mui/material";
import { ProviderHealthCard } from "./ProviderHealthCard";

export function ProviderHealthSection({ providers }) {
  if (!providers || providers.length === 0) return null;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
        gap: 2
      }}
    >
      {providers.map((provider) => (
        <ProviderHealthCard key={provider.id} provider={provider} />
      ))}
    </Box>
  );
}
