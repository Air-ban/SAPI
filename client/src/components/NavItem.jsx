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
        border: "1px solid",
        borderColor: active ? "app.sidebarBorder" : "transparent",
        transition:
          "transform 0.18s cubic-bezier(.2,.8,.2,1), background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease",
        "&::before": active
          ? {
              content: '""',
              position: "absolute",
              left: 0,
              top: 8,
              bottom: 8,
              width: 3,
              borderRadius: 999,
              background: (theme) => theme.palette.app.accentGradient
            }
          : undefined,
        "&:hover": {
          bgcolor: active ? "app.sidebarActive" : "app.sidebarHover",
          color: "app.sidebarText",
          transform: "translateX(2px)"
        },
        "&:active": {
          transform: "translateX(1px) scale(0.99)"
        },
        "@media (prefers-reduced-motion: reduce)": {
          "&:hover, &:active": {
            transform: "none"
          }
        }
      }}
    >
      <ListItemIcon sx={{ color: "inherit", minWidth: 32, transition: "color 0.15s ease" }}>
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            width: 24,
            height: 24,
            borderRadius: 0.9,
            bgcolor: active ? "rgba(255,255,255,0.12)" : "transparent",
            "& svg": { fontSize: 18 }
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
