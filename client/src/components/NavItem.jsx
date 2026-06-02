import React from "react";
import { ListItemButton, ListItemIcon, ListItemText, Box } from "@mui/material";

export const NavItem = React.memo(function NavItem({ active, icon, primary, secondary, onClick }) {
  return (
    <ListItemButton
      onClick={onClick}
      sx={{
        borderRadius: 2,
        py: 0.85,
        px: 1.5,
        position: "relative",
        overflow: "hidden",
        color: active ? "#fff" : "#94a3b8",
        bgcolor: active ? "rgba(255,255,255,0.1)" : "transparent",
        transition: "all 0.15s ease",
        "&:hover": {
          bgcolor: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
          color: active ? "#fff" : "#cbd5e1"
        },
        "&::before": active
          ? {
              content: '""',
              position: "absolute",
              left: 0,
              top: "20%",
              bottom: "20%",
              width: 3,
              borderRadius: "0 3px 3px 0",
              bgcolor: "#22d3ee",
              transition: "opacity 0.2s ease"
            }
          : {}
      }}
    >
      <ListItemIcon sx={{ color: "inherit", minWidth: 36, transition: "color 0.15s ease" }}>
        {icon}
      </ListItemIcon>
      <ListItemText
        primary={primary}
        secondary={secondary}
        slotProps={{
          primary: {
            variant: "body2",
            fontWeight: active ? 700 : 500,
            sx: { transition: "font-weight 0.15s ease" }
          },
          secondary: {
            variant: "caption",
            sx: {
              color: active ? "rgba(255,255,255,0.6)" : "#64748b",
              transition: "color 0.15s ease"
            }
          }
        }}
      />
    </ListItemButton>
  );
});
