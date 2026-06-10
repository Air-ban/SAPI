import { createTheme } from "@mui/material";

const palettes = {
  light: {
    mode: "light",
    bg: "#eef3f8",
    pageBg:
      "linear-gradient(135deg, #f7fafc 0%, #eef5f9 38%, #f6f2fb 72%, #f8fafc 100%)",
    paper: "rgba(255,255,255,0.78)",
    paperAlt: "rgba(244,248,252,0.72)",
    elevated: "rgba(255,255,255,0.88)",
    glass: "linear-gradient(145deg, rgba(255,255,255,0.82), rgba(255,255,255,0.58))",
    glassStrong: "linear-gradient(145deg, rgba(255,255,255,0.94), rgba(247,251,255,0.74))",
    glassBorder: "rgba(96, 115, 138, 0.22)",
    glassEdge: "rgba(255,255,255,0.78)",
    inputBg: "rgba(255,255,255,0.72)",
    text: "#101828",
    muted: "#475467",
    subtle: "#667085",
    border: "rgba(98, 116, 142, 0.22)",
    borderStrong: "rgba(75, 90, 112, 0.34)",
    primary: "#1263d1",
    primaryHover: "#0a55ba",
    primarySoft: "rgba(18,99,209,0.12)",
    primaryText: "#ffffff",
    accentCyan: "#008fa3",
    accentViolet: "#7657d6",
    accentRose: "#c43b6b",
    accentAmber: "#b66a00",
    accentGreen: "#067647",
    accentSoftCyan: "rgba(0,143,163,0.12)",
    accentSoftViolet: "rgba(118,87,214,0.12)",
    accentSoftRose: "rgba(196,59,107,0.12)",
    accentSoftAmber: "rgba(182,106,0,0.14)",
    success: "#067647",
    successSoft: "#e8f7ef",
    warning: "#b54708",
    warningSoft: "#fff4e5",
    error: "#c9181f",
    errorSoft: "#fde8ea",
    codeBg: "#111827",
    codeText: "#d1fae5",
    sidebarBg: "linear-gradient(165deg, #101826 0%, #0f2530 52%, #181927 100%)",
    sidebarText: "#f9fafb",
    sidebarMuted: "#cbd5e1",
    sidebarBorder: "rgba(255,255,255,0.16)",
    sidebarSurface: "rgba(255,255,255,0.06)",
    sidebarHover: "rgba(255,255,255,0.10)",
    sidebarActive: "rgba(255,255,255,0.14)",
    overlay: "rgba(255,255,255,0.74)",
    shadow: "0 18px 48px rgba(31, 44, 62, 0.14)",
    softShadow: "0 10px 30px rgba(31, 44, 62, 0.08)",
    accentGradient: "linear-gradient(135deg, #1263d1 0%, #008fa3 52%, #7657d6 100%)"
  },
  dark: {
    mode: "dark",
    bg: "#080d17",
    pageBg:
      "linear-gradient(135deg, #080d17 0%, #0d1824 42%, #171626 76%, #0b111f 100%)",
    paper: "rgba(18,26,39,0.76)",
    paperAlt: "rgba(28,39,57,0.68)",
    elevated: "rgba(21,31,48,0.88)",
    glass: "linear-gradient(145deg, rgba(31,43,62,0.76), rgba(13,22,36,0.62))",
    glassStrong: "linear-gradient(145deg, rgba(42,57,80,0.86), rgba(18,28,45,0.74))",
    glassBorder: "rgba(202, 220, 255, 0.16)",
    glassEdge: "rgba(255,255,255,0.16)",
    inputBg: "rgba(13,22,36,0.64)",
    text: "#f8fafc",
    muted: "#d0d7e2",
    subtle: "#aab4c5",
    border: "rgba(148,163,184,0.20)",
    borderStrong: "rgba(194,210,235,0.30)",
    primary: "#8fc5ff",
    primaryHover: "#b8dcff",
    primarySoft: "rgba(124,183,255,0.16)",
    primaryText: "#07111f",
    accentCyan: "#6ee7d8",
    accentViolet: "#b69bff",
    accentRose: "#ff8ab3",
    accentAmber: "#ffd166",
    accentGreen: "#5ee0a0",
    accentSoftCyan: "rgba(110,231,216,0.14)",
    accentSoftViolet: "rgba(182,155,255,0.14)",
    accentSoftRose: "rgba(255,138,179,0.14)",
    accentSoftAmber: "rgba(255,209,102,0.14)",
    success: "#5ee0a0",
    successSoft: "rgba(94,224,160,0.14)",
    warning: "#f7c46c",
    warningSoft: "rgba(247,196,108,0.16)",
    error: "#ff8a90",
    errorSoft: "rgba(255,138,144,0.16)",
    codeBg: "#050b16",
    codeText: "#c9f7df",
    sidebarBg: "linear-gradient(165deg, #050b16 0%, #0a1d28 48%, #171426 100%)",
    sidebarText: "#f8fafc",
    sidebarMuted: "#c8d2e1",
    sidebarBorder: "rgba(255,255,255,0.14)",
    sidebarSurface: "rgba(255,255,255,0.07)",
    sidebarHover: "rgba(255,255,255,0.11)",
    sidebarActive: "rgba(124,183,255,0.18)",
    overlay: "rgba(13,22,36,0.72)",
    shadow: "0 22px 60px rgba(0, 0, 0, 0.38)",
    softShadow: "0 12px 34px rgba(0, 0, 0, 0.22)",
    accentGradient: "linear-gradient(135deg, #8fc5ff 0%, #6ee7d8 52%, #b69bff 100%)"
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
        accentSoftCyan: c.accentSoftCyan,
        accentSoftViolet: c.accentSoftViolet,
        accentSoftRose: c.accentSoftRose,
        accentSoftAmber: c.accentSoftAmber,
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
            transition:
              "background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease, box-shadow 0.18s ease"
          },
          body: {
            minHeight: "100vh",
            background: c.pageBg,
            backgroundAttachment: "fixed",
            color: c.text
          },
          "#root": {
            minHeight: "100vh"
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
            borderRadius: 7,
            padding: "6px 14px",
            minHeight: 34,
            fontSize: 14,
            fontWeight: 560,
            borderColor: c.border,
            transition:
              "transform 0.18s cubic-bezier(.2,.8,.2,1), box-shadow 0.18s ease, background 0.18s ease, border-color 0.18s ease",
            "&:hover": {
              transform: "translateY(-1px)",
              boxShadow: c.softShadow
            },
            "&:active": {
              transform: "translateY(0) scale(0.985)"
            }
          },
          contained: {
            background: c.accentGradient,
            color: c.primaryText,
            border: `1px solid ${c.glassEdge}`,
            boxShadow: c.softShadow,
            "&:hover": {
              background: c.accentGradient,
              borderColor: c.primaryHover,
              boxShadow: c.shadow
            }
          },
          outlined: {
            color: c.text,
            borderColor: c.border,
            background: c.glass,
            backdropFilter: "blur(18px) saturate(1.18)",
            "&:hover": {
              background: c.glassStrong,
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
            borderRadius: 7
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
            backgroundImage: c.glass,
            backgroundColor: c.paper,
            color: c.text,
            backdropFilter: "blur(22px) saturate(1.18)"
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
            border: `1px solid ${c.glassBorder}`,
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
            background: c.glass,
            backdropFilter: "blur(18px) saturate(1.12)"
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
            letterSpacing: 0,
            backdropFilter: "blur(12px)"
          },
          sizeSmall: {
            height: 22,
            fontSize: 12
          },
          outlined: {
            borderColor: c.border,
            color: c.text,
            backgroundColor: c.mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.46)"
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
              borderRadius: 7,
              background: c.inputBg,
              backdropFilter: "blur(16px) saturate(1.12)",
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
            backgroundColor: c.mode === "dark" ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.42)",
            transition: "transform 0.16s cubic-bezier(.2,.8,.2,1), background-color 0.16s ease",
            "&:hover": {
              transform: "translateY(-1px)",
              backgroundColor: c.paperAlt
            },
            "&:active": {
              transform: "scale(0.985)"
            },
            "&.Mui-selected": {
              color: c.primaryText,
              background: c.accentGradient,
              "&:hover": {
                background: c.accentGradient
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
            border: `1px solid ${c.glassBorder}`,
            boxShadow: c.shadow,
            background: c.glassStrong,
            backdropFilter: "blur(28px) saturate(1.22)",
            color: c.text
          }
        }
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition:
              "transform 0.18s cubic-bezier(.2,.8,.2,1), background-color 0.18s ease, color 0.18s ease",
            "&:hover": {
              transform: "translateY(-1px)",
              backgroundColor: c.primarySoft
            },
            "&:active": {
              transform: "translateY(0) scale(0.94)"
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
            background: c.accentGradient,
            border: 0
          },
          thumb: {
            width: 16,
            height: 16,
            backgroundColor: c.mode === "dark" ? "#f8fafc" : "#ffffff",
            border: `2px solid ${c.primary}`,
            boxShadow: c.softShadow,
            "&:hover, &.Mui-focusVisible": {
              boxShadow: c.shadow
            }
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
