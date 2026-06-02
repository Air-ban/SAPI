import { createTheme } from "@mui/material";

export default createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0d7377",
      light: "#14a3a8",
      dark: "#0a5c5f"
    },
    secondary: {
      main: "#3b5998",
      light: "#5b7db5",
      dark: "#2d4373"
    },
    success: { main: "#10b981", light: "#34d399", dark: "#059669" },
    warning: { main: "#f59e0b", light: "#fbbf24", dark: "#d97706" },
    error: { main: "#ef4444", light: "#f87171", dark: "#dc2626" },
    background: {
      default: "#f1f5f9",
      paper: "#ffffff"
    },
    text: {
      primary: "#0f172a",
      secondary: "#475569"
    },
    divider: "#e2e8f0"
  },
  shape: {
    borderRadius: 10
  },
  shadows: [
    "none",
    "0 1px 2px 0 rgba(0,0,0,0.04)",
    "0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.06)",
    "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05)",
    "0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -4px rgba(0,0,0,0.05)",
    "0 20px 25px -5px rgba(0,0,0,0.07), 0 8px 10px -6px rgba(0,0,0,0.05)",
    "0 25px 30px -6px rgba(0,0,0,0.08), 0 10px 14px -8px rgba(0,0,0,0.06)",
    "0 30px 36px -7px rgba(0,0,0,0.09), 0 12px 18px -10px rgba(0,0,0,0.07)",
    "0 35px 42px -8px rgba(0,0,0,0.10), 0 14px 22px -12px rgba(0,0,0,0.08)",
    "0 40px 48px -10px rgba(0,0,0,0.11), 0 16px 26px -14px rgba(0,0,0,0.09)",
    "0 45px 54px -12px rgba(0,0,0,0.12), 0 18px 30px -16px rgba(0,0,0,0.10)",
    "0 50px 60px -14px rgba(0,0,0,0.13), 0 20px 34px -18px rgba(0,0,0,0.11)",
    "0 55px 66px -16px rgba(0,0,0,0.14), 0 22px 38px -20px rgba(0,0,0,0.12)",
    "0 60px 72px -18px rgba(0,0,0,0.15), 0 24px 42px -22px rgba(0,0,0,0.13)",
    "0 65px 78px -20px rgba(0,0,0,0.16), 0 26px 46px -24px rgba(0,0,0,0.14)",
    "0 70px 84px -22px rgba(0,0,0,0.17), 0 28px 50px -26px rgba(0,0,0,0.15)",
    "0 75px 90px -24px rgba(0,0,0,0.18), 0 30px 54px -28px rgba(0,0,0,0.16)",
    "0 80px 96px -26px rgba(0,0,0,0.19), 0 32px 58px -30px rgba(0,0,0,0.17)",
    "0 85px 102px -28px rgba(0,0,0,0.20), 0 34px 62px -32px rgba(0,0,0,0.18)",
    "0 90px 108px -30px rgba(0,0,0,0.21), 0 36px 66px -34px rgba(0,0,0,0.19)",
    "0 95px 114px -32px rgba(0,0,0,0.22), 0 38px 70px -36px rgba(0,0,0,0.20)",
    "0 100px 120px -34px rgba(0,0,0,0.23), 0 40px 74px -38px rgba(0,0,0,0.21)",
    "0 105px 126px -36px rgba(0,0,0,0.24), 0 42px 76px -40px rgba(0,0,0,0.22)",
    "0 110px 132px -38px rgba(0,0,0,0.25), 0 44px 78px -42px rgba(0,0,0,0.23)"
  ],
  typography: {
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    h4: {
      fontWeight: 700,
      letterSpacing: "-0.02em",
      lineHeight: 1.25
    },
    h5: {
      fontWeight: 680,
      letterSpacing: "-0.01em",
      lineHeight: 1.3
    },
    h6: {
      fontWeight: 680,
      letterSpacing: "-0.005em",
      lineHeight: 1.35
    },
    subtitle1: {
      fontWeight: 620,
      letterSpacing: 0
    },
    body1: {
      lineHeight: 1.65,
      letterSpacing: 0
    },
    body2: {
      lineHeight: 1.6,
      letterSpacing: 0
    },
    button: {
      fontWeight: 640,
      letterSpacing: "0.01em"
    },
    overline: {
      fontWeight: 750,
      letterSpacing: "0.08em",
      fontSize: "0.7rem"
    },
    caption: {
      letterSpacing: 0
    }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "*, *::before, *::after": {
          transition: "background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease"
        },
        "::-webkit-scrollbar": {
          width: 6,
          height: 6
        },
        "::-webkit-scrollbar-track": {
          background: "transparent"
        },
        "::-webkit-scrollbar-thumb": {
          background: "#94a3b8",
          borderRadius: 3
        },
        "::-webkit-scrollbar-thumb:hover": {
          background: "#64748b"
        },
        ":focus-visible": {
          outline: "2px solid #0d7377",
          outlineOffset: 2,
          borderRadius: 4
        }
      }
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 8,
          padding: "6px 16px",
          fontWeight: 640,
          transition: "all 0.15s ease"
        },
        contained: {
          boxShadow: "0 1px 2px rgba(13,115,119,0.25)",
          "&:hover": {
            boxShadow: "0 2px 8px rgba(13,115,119,0.32)",
            transform: "translateY(-0.5px)"
          },
          "&:active": {
            transform: "translateY(0)"
          }
        },
        outlined: {
          "&:hover": {
            transform: "translateY(-0.5px)"
          },
          "&:active": {
            transform: "translateY(0)"
          }
        },
        sizeSmall: {
          padding: "4px 12px",
          fontSize: "0.8125rem",
          borderRadius: 6
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none"
        },
        outlined: {
          borderColor: "#e2e8f0",
          transition: "box-shadow 0.2s ease, border-color 0.2s ease",
          "&:hover": {
            borderColor: "#cbd5e1"
          }
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          color: "#64748b",
          fontSize: 12,
          fontWeight: 750,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          borderBottom: "2px solid #e2e8f0"
        },
        body: {
          borderBottom: "1px solid #f1f5f9"
        }
      }
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&:hover": {
            backgroundColor: "#f8fafc"
          }
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          letterSpacing: 0
        },
        sizeSmall: {
          height: 22,
          fontSize: "0.7rem"
        }
      }
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 8,
            transition: "box-shadow 0.15s ease, border-color 0.15s ease",
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "#94a3b8"
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderWidth: 1.5
            }
          }
        }
      }
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          borderRadius: 6,
          padding: "6px 12px",
          fontSize: "0.75rem",
          backgroundColor: "#1e293b"
        }
      }
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          alignItems: "center"
        },
        standardInfo: {
          backgroundColor: "#eff6ff",
          color: "#1e40af"
        },
        standardWarning: {
          backgroundColor: "#fffbeb",
          color: "#92400e"
        },
        standardSuccess: {
          backgroundColor: "#ecfdf5",
          color: "#065f46"
        },
        standardError: {
          backgroundColor: "#fef2f2",
          color: "#991b1b"
        }
      }
    },
    MuiSnackbar: {
      styleOverrides: {
        root: {
          "& .MuiAlert-filled": {
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)"
          }
        }
      }
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          width: 44,
          height: 24,
          padding: 0,
          "& .MuiSwitch-switchBase": {
            padding: 1,
            "&.Mui-checked": {
              transform: "translateX(20px)",
              "& + .MuiSwitch-track": {
                opacity: 1
              }
            }
          },
          "& .MuiSwitch-thumb": {
            width: 22,
            height: 22
          },
          "& .MuiSwitch-track": {
            borderRadius: 12,
            opacity: 0.15
          }
        }
      }
    }
  }
});
