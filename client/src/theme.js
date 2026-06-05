import { createTheme } from "@mui/material";

const palettes = {
  light: {
    mode: "light",
    bg: "#f7f8fb",
    paper: "#ffffff",
    paperAlt: "#f1f5f9",
    elevated: "#ffffff",
    text: "#101828",
    muted: "#475467",
    subtle: "#667085",
    border: "#d7dde8",
    borderStrong: "#b8c2d4",
    primary: "#0f5cc0",
    primaryHover: "#0b4da4",
    primarySoft: "#e7f0ff",
    primaryText: "#ffffff",
    success: "#067647",
    successSoft: "#e8f7ef",
    warning: "#b54708",
    warningSoft: "#fff4e5",
    error: "#c9181f",
    errorSoft: "#fde8ea",
    codeBg: "#111827",
    codeText: "#d1fae5",
    sidebarBg: "#111827",
    sidebarText: "#f9fafb",
    sidebarMuted: "#cbd5e1",
    sidebarBorder: "rgba(255,255,255,0.16)",
    sidebarSurface: "rgba(255,255,255,0.06)",
    sidebarHover: "rgba(255,255,255,0.10)",
    sidebarActive: "rgba(255,255,255,0.14)",
    overlay: "rgba(255,255,255,0.86)",
    shadow: "0 16px 42px rgba(15, 23, 42, 0.10)"
  },
  dark: {
    mode: "dark",
    bg: "#0b1020",
    paper: "#111827",
    paperAlt: "#172033",
    elevated: "#151f32",
    text: "#f8fafc",
    muted: "#d0d7e2",
    subtle: "#aab4c5",
    border: "#334155",
    borderStrong: "#475569",
    primary: "#7cb7ff",
    primaryHover: "#a8ceff",
    primarySoft: "rgba(124,183,255,0.16)",
    primaryText: "#07111f",
    success: "#5ee0a0",
    successSoft: "rgba(94,224,160,0.14)",
    warning: "#f7c46c",
    warningSoft: "rgba(247,196,108,0.16)",
    error: "#ff8a90",
    errorSoft: "rgba(255,138,144,0.16)",
    codeBg: "#050b16",
    codeText: "#c9f7df",
    sidebarBg: "#050b16",
    sidebarText: "#f8fafc",
    sidebarMuted: "#c8d2e1",
    sidebarBorder: "rgba(255,255,255,0.14)",
    sidebarSurface: "rgba(255,255,255,0.07)",
    sidebarHover: "rgba(255,255,255,0.11)",
    sidebarActive: "rgba(124,183,255,0.18)",
    overlay: "rgba(17,24,39,0.88)",
    shadow: "0 18px 48px rgba(0, 0, 0, 0.34)"
  }
};

export function createAppTheme(mode = "light") {
  const c = palettes[mode] || palettes.light;

  return createTheme({
    palette: {
      mode: c.mode,
      primary: {
        main: c.primary,
        light: c.primaryHover,
        dark: c.primary,
        contrastText: c.primaryText
      },
      secondary: {
        main: c.success,
        light: c.success,
        dark: c.success,
        contrastText: c.mode === "dark" ? "#07111f" : "#ffffff"
      },
      success: { main: c.success, light: c.success, dark: c.success },
      warning: { main: c.warning, light: c.warning, dark: c.warning },
      error: { main: c.error, light: c.error, dark: c.error },
      background: {
        default: c.bg,
        paper: c.paper
      },
      text: {
        primary: c.text,
        secondary: c.muted,
        disabled: c.subtle
      },
      divider: c.border,
      app: {
        paperAlt: c.paperAlt,
        elevated: c.elevated,
        textSubtle: c.subtle,
        borderStrong: c.borderStrong,
        primarySoft: c.primarySoft,
        successSoft: c.successSoft,
        warningSoft: c.warningSoft,
        errorSoft: c.errorSoft,
        codeBg: c.codeBg,
        codeText: c.codeText,
        sidebarBg: c.sidebarBg,
        sidebarText: c.sidebarText,
        sidebarMuted: c.sidebarMuted,
        sidebarBorder: c.sidebarBorder,
        sidebarSurface: c.sidebarSurface,
        sidebarHover: c.sidebarHover,
        sidebarActive: c.sidebarActive,
        overlay: c.overlay,
        shadow: c.shadow
      }
    },
    shape: {
      borderRadius: 8
    },
    shadows: Array(25).fill("none"),
    typography: {
      fontFamily:
        'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      h2: {
        fontWeight: 760,
        letterSpacing: 0,
        lineHeight: 1.05
      },
      h4: {
        fontWeight: 680,
        letterSpacing: 0,
        lineHeight: 1.22
      },
      h5: {
        fontWeight: 650,
        letterSpacing: 0,
        lineHeight: 1.25
      },
      h6: {
        fontWeight: 650,
        letterSpacing: 0,
        lineHeight: 1.35
      },
      subtitle1: {
        fontWeight: 600,
        letterSpacing: 0
      },
      body1: {
        lineHeight: 1.6,
        letterSpacing: 0
      },
      body2: {
        lineHeight: 1.55,
        letterSpacing: 0
      },
      button: {
        fontWeight: 560,
        letterSpacing: 0
      },
      overline: {
        fontWeight: 600,
        letterSpacing: 0,
        fontSize: "0.75rem",
        textTransform: "none"
      },
      caption: {
        letterSpacing: 0
      }
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          "*, *::before, *::after": {
            boxSizing: "border-box",
            transition: "background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease"
          },
          body: {
            background: c.bg,
            color: c.text
          },
          "::-webkit-scrollbar": {
            width: 8,
            height: 8
          },
          "::-webkit-scrollbar-track": {
            background: "transparent"
          },
          "::-webkit-scrollbar-thumb": {
            background: c.borderStrong,
            borderRadius: 8,
            border: "2px solid transparent",
            backgroundClip: "padding-box"
          },
          "::-webkit-scrollbar-thumb:hover": {
            background: c.subtle,
            backgroundClip: "padding-box"
          },
          ":focus-visible": {
            outline: `2px solid ${c.primary}`,
            outlineOffset: 2
          }
        }
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            textTransform: "none",
            borderRadius: 6,
            padding: "6px 14px",
            minHeight: 34,
            fontSize: 14,
            fontWeight: 560,
            borderColor: c.border
          },
          contained: {
            background: c.primary,
            color: c.primaryText,
            border: `1px solid ${c.primary}`,
            "&:hover": {
              background: c.primaryHover,
              borderColor: c.primaryHover
            }
          },
          outlined: {
            color: c.text,
            borderColor: c.border,
            background: c.paper,
            "&:hover": {
              background: c.paperAlt,
              borderColor: c.borderStrong
            }
          },
          text: {
            color: c.text,
            "&:hover": {
              background: c.paperAlt
            }
          },
          sizeSmall: {
            minHeight: 30,
            padding: "4px 10px",
            fontSize: 13,
            borderRadius: 6
          },
          sizeLarge: {
            minHeight: 42,
            padding: "8px 18px",
            fontSize: 15
          }
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: c.paper,
            color: c.text
          },
          outlined: {
            borderColor: c.border,
            boxShadow: "none"
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            border: `1px solid ${c.border}`,
            boxShadow: "none",
            backgroundColor: c.paper,
            color: c.text
          }
        }
      },
      MuiTableContainer: {
        styleOverrides: {
          root: {
            border: `1px solid ${c.border}`,
            borderRadius: 8
          }
        }
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            color: c.muted,
            fontSize: 12,
            fontWeight: 600,
            textTransform: "none",
            letterSpacing: 0,
            backgroundColor: c.paperAlt,
            borderBottom: `1px solid ${c.border}`
          },
          body: {
            borderBottom: `1px solid ${c.border}`,
            fontSize: 14
          }
        }
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            "&:last-child td": {
              borderBottom: 0
            },
            "&:hover": {
              backgroundColor: c.paperAlt
            }
          }
        }
      },
      MuiChip: {
        styleOverrides: {
          root: {
            height: 24,
            borderRadius: 999,
            fontWeight: 520,
            letterSpacing: 0
          },
          sizeSmall: {
            height: 22,
            fontSize: 12
          },
          outlined: {
            borderColor: c.border,
            color: c.text
          }
        }
      },
      MuiTextField: {
        defaultProps: {
          size: "small"
        },
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              minHeight: 40,
              borderRadius: 6,
              background: c.paper,
              color: c.text,
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: c.border
              },
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: c.borderStrong
              },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                borderWidth: 1,
                borderColor: c.primary
              }
            },
            "& .MuiInputLabel-root": {
              color: c.muted
            },
            "& .MuiFormHelperText-root": {
              color: c.subtle
            }
          }
        }
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            color: c.muted,
            borderColor: c.border,
            "&.Mui-selected": {
              color: c.primaryText,
              backgroundColor: c.primary,
              "&:hover": {
                backgroundColor: c.primaryHover
              }
            }
          }
        }
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 12,
            backgroundColor: c.text,
            color: c.bg
          }
        }
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            border: `1px solid ${c.border}`,
            backgroundColor: c.paper,
            color: c.text
          },
          filledSuccess: {
            backgroundColor: c.success,
            color: c.mode === "dark" ? "#07111f" : "#ffffff"
          },
          filledError: {
            backgroundColor: c.error,
            color: c.mode === "dark" ? "#07111f" : "#ffffff"
          }
        }
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 10,
            border: `1px solid ${c.border}`,
            boxShadow: c.shadow,
            backgroundColor: c.elevated,
            color: c.text
          }
        }
      },
      MuiSwitch: {
        styleOverrides: {
          root: {
            width: 38,
            height: 22,
            padding: 0,
            "& .MuiSwitch-switchBase": {
              padding: 2,
              "&.Mui-checked": {
                transform: "translateX(16px)",
                color: c.primaryText,
                "& + .MuiSwitch-track": {
                  opacity: 1,
                  backgroundColor: c.primary
                }
              }
            },
            "& .MuiSwitch-thumb": {
              width: 18,
              height: 18
            },
            "& .MuiSwitch-track": {
              borderRadius: 999,
              opacity: 1,
              backgroundColor: c.borderStrong
            }
          }
        }
      }
    }
  });
}

export default createAppTheme("light");
