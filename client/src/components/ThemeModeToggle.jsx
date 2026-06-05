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
        sx={sx}
      >
        {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
