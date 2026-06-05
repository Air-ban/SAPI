import React from "react";
import { ListItemButton, ListItemIcon, ListItemText, Box } from "@mui/material";

export const NavItem = React.memo(function NavItem({ active, icon, primary, secondary, onClick }) {
  return (
    <ListItemButton
      onClick={onClick}
      sx={{
        borderRadius: 1.25,
        py: 0.7,
        px: 1,
        position: "relative",
        overflow: "hidden",
        color: active ? "app.sidebarText" : "app.sidebarMuted",
        bgcolor: active ? "app.sidebarActive" : "transparent",
        transition: "all 0.15s ease",
        "&:hover": {
          bgcolor: active ? "app.sidebarActive" : "app.sidebarHover",
          color: "app.sidebarText"
        }
      }}
    >
      <ListItemIcon sx={{ color: "inherit", minWidth: 30, transition: "color 0.15s ease" }}>
        <Box sx={{ display: "flex", "& svg": { fontSize: 18 } }}>{icon}</Box>
      </ListItemIcon>
      <ListItemText
        primary={primary}
        secondary={secondary}
        slotProps={{
          primary: {
            variant: "body2",
            fontWeight: active ? 620 : 500,
            sx: { transition: "font-weight 0.15s ease" }
          },
          secondary: {
            variant: "caption",
            sx: {
              color: "app.sidebarMuted",
              transition: "color 0.15s ease"
            }
          }
        }}
      />
    </ListItemButton>
  );
});
