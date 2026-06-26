import { createTheme } from "@mui/material";

const palettes = {
  light: {
    mode: "light",
    bg: "#ffffff",
    pageBg: "#ffffff",
    paper: "#ffffff",
    paperAlt: "#fafafa",
    elevated: "#ffffff",
    glass: "#ffffff",
    glassStrong: "#ffffff",
    glassBorder: "rgba(0, 0, 0, 0.08)",
    glassEdge: "rgba(0, 0, 0, 0.08)",
    inputBg: "#ffffff",
    text: "#171717",
    muted: "#4d4d4d",
    subtle: "#666666",
    border: "rgba(0, 0, 0, 0.08)",
    borderStrong: "rgba(0, 0, 0, 0.15)",
    primary: "#171717",
    primaryHover: "#333333",
    primarySoft: "rgba(0, 0, 0, 0.04)",
    primaryText: "#ffffff",
    accentCyan: "#0070f3",
    accentViolet: "#7928ca",
    accentRose: "#eb367f",
    accentAmber: "#f7c46c",
    accentGreen: "#0068d6",
    success: "#0068d6",
    successSoft: "#ebf5ff",
    warning: "#f7c46c",
    warningSoft: "#fffdf0",
    error: "#ff5b4f",
    errorSoft: "#fff5f5",
    codeBg: "#0a0a0a",
    codeText: "#ededed",
    sidebarBg: "#ffffff",
    sidebarText: "#171717",
    sidebarMuted: "#666666",
    sidebarBorder: "rgba(0, 0, 0, 0.08)",
    sidebarSurface: "rgba(0, 0, 0, 0.02)",
    sidebarHover: "rgba(0, 0, 0, 0.04)",
    sidebarActive: "rgba(0, 0, 0, 0.06)",
    overlay: "rgba(255, 255, 255, 0.8)",
    shadow: "rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 8px 8px -8px, #fafafa 0px 0px 0px 1px",
    softShadow: "rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.02) 0px 2px 2px, #fafafa 0px 0px 0px 1px",
    accentGradient: "linear-gradient(135deg, #171717 0%, #4d4d4d 100%)"
  },
  dark: {
    mode: "dark",
    bg: "#0a0a0a",
    pageBg: "#0a0a0a",
    paper: "#000000",
    paperAlt: "#111111",
    elevated: "#000000",
    glass: "#000000",
    glassStrong: "#000000",
    glassBorder: "rgba(255, 255, 255, 0.15)",
    glassEdge: "rgba(255, 255, 255, 0.15)",
    inputBg: "#000000",
    text: "#ededed",
    muted: "#a0a0a0",
    subtle: "#808080",
    border: "rgba(255, 255, 255, 0.15)",
    borderStrong: "rgba(255, 255, 255, 0.25)",
    primary: "#ffffff",
    primaryHover: "#e6e6e6",
    primarySoft: "rgba(255, 255, 255, 0.06)",
    primaryText: "#0a0a0a",
    accentCyan: "#0070f3",
    accentViolet: "#7928ca",
    accentRose: "#eb367f",
    accentAmber: "#f7c46c",
    accentGreen: "#0068d6",
    success: "#0068d6",
    successSoft: "rgba(0, 104, 214, 0.15)",
    warning: "#f7c46c",
    warningSoft: "rgba(247, 196, 108, 0.15)",
    error: "#ff5b4f",
    errorSoft: "rgba(255, 91, 79, 0.15)",
    codeBg: "#000000",
    codeText: "#ffffff",
    sidebarBg: "#000000",
    sidebarText: "#ededed",
    sidebarMuted: "#808080",
    sidebarBorder: "rgba(255, 255, 255, 0.15)",
    sidebarSurface: "rgba(255, 255, 255, 0.04)",
    sidebarHover: "rgba(255, 255, 255, 0.08)",
    sidebarActive: "rgba(255, 255, 255, 0.12)",
    overlay: "rgba(0, 0, 0, 0.8)",
    shadow: "rgba(255, 255, 255, 0.15) 0px 0px 0px 1px, rgba(0, 0, 0, 0.5) 0px 8px 8px -8px, #111111 0px 0px 0px 1px",
    softShadow: "rgba(255, 255, 255, 0.15) 0px 0px 0px 1px, rgba(0, 0, 0, 0.3) 0px 2px 2px, #111111 0px 0px 0px 1px",
    accentGradient: "linear-gradient(135deg, #ffffff 0%, #a0a0a0 100%)"
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
        contrastText: c.mode === "dark" ? "#0a0a0a" : "#ffffff"
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
        glass: c.glass,
        glassStrong: c.glassStrong,
        glassBorder: c.glassBorder,
        glassEdge: c.glassEdge,
        inputBg: c.inputBg,
        accentCyan: c.accentCyan,
        accentViolet: c.accentViolet,
        accentRose: c.accentRose,
        accentAmber: c.accentAmber,
        accentGreen: c.accentGreen,
        accentSoftCyan: c.successSoft,
        accentSoftViolet: c.successSoft,
        accentSoftRose: c.errorSoft,
        accentSoftAmber: c.warningSoft,
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
        shadow: c.shadow,
        softShadow: c.softShadow,
        accentGradient: c.accentGradient,
        pageBg: c.pageBg
      }
    },
    shape: {
      borderRadius: 6
    },
    shadows: Array(25).fill("none"),
    typography: {
      fontFamily:
        'Geist, Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      h2: {
        fontWeight: 600,
        letterSpacing: "-2.4px",
        lineHeight: 1.1
      },
      h4: {
        fontWeight: 600,
        letterSpacing: "-1.28px",
        lineHeight: 1.25
      },
      h5: {
        fontWeight: 600,
        letterSpacing: "-0.96px",
        lineHeight: 1.3
      },
      h6: {
        fontWeight: 600,
        letterSpacing: "-0.32px",
        lineHeight: 1.35
      },
      subtitle1: {
        fontWeight: 500,
        letterSpacing: "-0.32px"
      },
      body1: {
        lineHeight: 1.5,
        letterSpacing: "normal"
      },
      body2: {
        lineHeight: 1.5,
        letterSpacing: "normal"
      },
      button: {
        fontWeight: 500,
        letterSpacing: "normal"
      },
      overline: {
        fontWeight: 600,
        letterSpacing: "normal",
        fontSize: "0.75rem",
        textTransform: "none"
      },
      caption: {
        letterSpacing: "normal"
      }
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          "*, *::before, *::after": {
            boxSizing: "border-box",
            transition:
              "background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease"
          },
          body: {
            minHeight: "100vh",
            background: c.pageBg,
            color: c.text
          },
          "#root": {
            minHeight: "100vh"
          },
          "::-webkit-scrollbar": {
            width: 6,
            height: 6
          },
          "::-webkit-scrollbar-track": {
            background: "transparent"
          },
          "::-webkit-scrollbar-thumb": {
            background: c.borderStrong,
            borderRadius: 6,
            border: "1px solid transparent",
            backgroundClip: "padding-box"
          },
          "::-webkit-scrollbar-thumb:hover": {
            background: c.subtle,
            backgroundClip: "padding-box"
          },
          ":focus-visible": {
            outline: `2px solid #0070f3`,
            outlineOffset: 2
          },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animationDuration: "0.01ms !important",
              animationIterationCount: "1 !important",
              scrollBehavior: "auto !important",
              transitionDuration: "0.01ms !important"
            }
          }
        }
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            textTransform: "none",
            borderRadius: 6,
            padding: "6px 12px",
            minHeight: 34,
            fontSize: 14,
            fontWeight: 500,
            borderColor: c.border,
            transition: "background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease",
            "&:hover": {
              boxShadow: c.softShadow
            }
          },
          contained: {
            background: c.primary,
            color: c.primaryText,
            border: `1px solid transparent`,
            "&:hover": {
              background: c.primaryHover,
              borderColor: "transparent"
            }
          },
          outlined: {
            color: c.text,
            borderColor: c.border,
            background: c.bg,
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
            padding: "4px 8px",
            fontSize: 13,
            borderRadius: 6
          },
          sizeLarge: {
            minHeight: 40,
            padding: "8px 16px",
            fontSize: 15
          }
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: c.paper,
            color: c.text
          },
          outlined: {
            borderColor: c.glassBorder,
            boxShadow: c.softShadow
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            border: 0,
            boxShadow: c.softShadow,
            backgroundColor: c.paper,
            color: c.text
          }
        }
      },
      MuiTableContainer: {
        styleOverrides: {
          root: {
            border: `1px solid ${c.border}`,
            borderRadius: 8,
            overflow: "hidden",
            background: c.paper
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
            letterSpacing: "normal",
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
            borderRadius: 9999,
            fontWeight: 500,
            letterSpacing: "normal"
          },
          sizeSmall: {
            height: 20,
            fontSize: 12
          },
          outlined: {
            borderColor: c.border,
            color: c.text,
            backgroundColor: c.paperAlt
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
              minHeight: 38,
              borderRadius: 6,
              background: c.inputBg,
              color: c.text,
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: c.border
              },
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: c.borderStrong
              },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                borderWidth: 1,
                borderColor: "#0070f3"
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
            backgroundColor: c.paperAlt,
            transition: "background-color 0.12s ease",
            "&:hover": {
              backgroundColor: c.paperAlt
            },
            "&.Mui-selected": {
              color: c.primaryText,
              background: c.primary,
              "&:hover": {
                background: c.primary
              }
            }
          }
        }
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 12,
            backgroundColor: c.text,
            color: c.bg
          }
        }
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            border: `1px solid ${c.border}`,
            backgroundColor: c.paperAlt,
            color: c.text
          },
          filledSuccess: {
            backgroundColor: c.success,
            color: "#ffffff"
          },
          filledError: {
            backgroundColor: c.error,
            color: "#ffffff"
          }
        }
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 8,
            border: `1px solid ${c.glassBorder}`,
            boxShadow: c.shadow,
            background: c.paper,
            color: c.text
          }
        }
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: "background-color 0.12s ease, color 0.12s ease",
            "&:hover": {
              backgroundColor: c.primarySoft
            }
          }
        }
      },
      MuiSelect: {
        styleOverrides: {
          select: {
            minHeight: "unset"
          }
        }
      },
      MuiSlider: {
        styleOverrides: {
          rail: {
            opacity: 1,
            backgroundColor: c.borderStrong
          },
          track: {
            background: c.primary,
            border: 0
          },
          thumb: {
            width: 14,
            height: 14,
            backgroundColor: c.mode === "dark" ? "#ffffff" : "#000000",
            border: `1px solid ${c.border}`,
            boxShadow: c.softShadow
          }
        }
      },
      MuiSwitch: {
        styleOverrides: {
          root: {
            width: 36,
            height: 20,
            padding: 0,
            "& .MuiSwitch-switchBase": {
              padding: 2,
              "&.Mui-checked": {
                transform: "translateX(16px)",
                color: "#ffffff",
                "& + .MuiSwitch-track": {
                  opacity: 1,
                  backgroundColor: "#0070f3"
                }
              }
            },
            "& .MuiSwitch-thumb": {
              width: 16,
              height: 16
            },
            "& .MuiSwitch-track": {
              borderRadius: 9999,
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
