import React from "react";
import { IconButton, Tooltip } from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";

export function ThemeModeToggle({ mode, onToggle, sx }) {
  const isDark = mode === "dark";

  return (
    <Tooltip title={isDark ? "切换到白模式" : "切换到暗黑模式"}>
      <IconButton
        aria-label={isDark ? "切换到白模式" : "切换到暗黑模式"}
        onClick={onToggle}
        size="small"
        sx={{
          border: "1px solid",
          borderColor: "app.glassBorder",
          bgcolor: "app.sidebarSurface",
          backdropFilter: "blur(14px) saturate(1.16)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
          ...sx
        }}
      >
        {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
