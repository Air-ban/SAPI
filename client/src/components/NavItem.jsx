import React from "react";
import { ListItemButton, ListItemIcon, ListItemText, Box } from "@mui/material";

export const NavItem = React.memo(function NavItem({ active, icon, primary, secondary, onClick }) {
  return (
    <ListItemButton
      onClick={onClick}
      sx={{
        borderRadius: "6px",
        py: 0.6,
        px: 1.2,
        position: "relative",
        overflow: "hidden",
        color: active ? "app.sidebarText" : "app.sidebarMuted",
        bgcolor: active ? "app.sidebarActive" : "transparent",
        transition: "background-color 0.12s ease, color 0.12s ease",
        "&::before": active
          ? {
              content: '""',
              position: "absolute",
              left: 0,
              top: 8,
              bottom: 8,
              width: 2,
              borderRadius: 999,
              background: (theme) => theme.palette.text.primary
            }
          : undefined,
        "&:hover": {
          bgcolor: active ? "app.sidebarActive" : "app.sidebarHover",
          color: "app.sidebarText"
        }
      }}
    >
      <ListItemIcon sx={{ color: "inherit", minWidth: 28, transition: "color 0.12s ease" }}>
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            width: 20,
            height: 20,
            bgcolor: "transparent",
            "& svg": { fontSize: 16 }
          }}
        >
          {icon}
        </Box>
      </ListItemIcon>
      <ListItemText
        primary={primary}
        secondary={secondary}
        slotProps={{
          primary: {
            variant: "body2",
            fontWeight: active ? 550 : 450,
            sx: { transition: "font-weight 0.12s ease" }
          },
          secondary: {
            variant: "caption",
            sx: {
              color: "app.sidebarMuted",
              transition: "color 0.12s ease"
            }
          }
        }}
      />
    </ListItemButton>
  );
});
