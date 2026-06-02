import React, { useMemo } from "react";
import { Box, Stack, Tooltip, Typography } from "@mui/material";
import { formatNumber } from "../utils/helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const COLORS = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getLevel(requests, maxRequests) {
  if (!requests) return 0;
  if (maxRequests <= 1) return 1;
  return Math.min(4, Math.max(1, Math.ceil((requests / maxRequests) * 4)));
}

export function RequestHeatmap({ data = [], days = 365, title = "调用热力图" }) {
  const { cells, monthLabels, totalRequests, maxRequests, weekCount } = useMemo(() => {
    const today = startOfDay(new Date());
    const firstDay = addDays(today, -(days - 1));
    const gridStart = addDays(firstDay, -firstDay.getDay());
    const byDay = new Map();

    data.forEach((item) => {
      if (!item?.day) return;
      byDay.set(item.day, {
        requests: Number(item.requests || 0),
        totalTokens: Number(item.totalTokens || 0),
        failedRequests: Number(item.failedRequests || 0)
      });
    });

    const gridDays = Math.ceil((today.getTime() - gridStart.getTime()) / DAY_MS) + 1;
    const weeks = Math.ceil(gridDays / 7);
    const items = [];
    let total = 0;
    let max = 0;

    for (let i = 0; i < weeks * 7; i += 1) {
      const date = addDays(gridStart, i);
      const key = toDateKey(date);
      const inRange = date >= firstDay && date <= today;
      const stat = byDay.get(key) || { requests: 0, totalTokens: 0, failedRequests: 0 };

      if (inRange) {
        total += stat.requests;
        max = Math.max(max, stat.requests);
      }

      items.push({
        key,
        date,
        day: date.getDay() + 1,
        week: Math.floor(i / 7) + 1,
        inRange,
        ...stat
      });
    }

    const months = [];
    let lastMonth = -1;
    items.forEach((item) => {
      if (!item.inRange || item.date.getMonth() === lastMonth) return;
      months.push({
        label: MONTH_LABELS[item.date.getMonth()],
        week: item.week
      });
      lastMonth = item.date.getMonth();
    });

    return {
      cells: items,
      monthLabels: months,
      totalRequests: total,
      maxRequests: max,
      weekCount: weeks
    };
  }, [data, days]);

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 780 }}>
            过去一年内 {formatNumber(totalRequests)} 次调用
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {title}，颜色越深表示当天调用次数越多。
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            少
          </Typography>
          {COLORS.map((color) => (
            <Box
              key={color}
              sx={{
                width: 12,
                height: 12,
                borderRadius: 0.5,
                bgcolor: color,
                border: "1px solid rgba(15,23,42,0.06)"
              }}
            />
          ))}
          <Typography variant="caption" color="text.secondary">
            多
          </Typography>
        </Stack>
      </Stack>

      <Box sx={{ overflowX: "auto", pb: 0.5 }}>
        <Box sx={{ minWidth: weekCount * 15 + 42 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: `42px repeat(${weekCount}, 12px)`,
              columnGap: "3px",
              mb: 0.75,
              color: "text.secondary",
              fontSize: 12
            }}
          >
            <Box />
            {monthLabels.map((month) => (
              <Box
                key={`${month.label}-${month.week}`}
                sx={{
                  gridColumn: `${month.week + 1} / span 4`,
                  whiteSpace: "nowrap"
                }}
              >
                {month.label}
              </Box>
            ))}
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: `42px repeat(${weekCount}, 12px)`,
              gridTemplateRows: "repeat(7, 12px)",
              gap: "3px"
            }}
          >
            {WEEKDAY_LABELS.map((label, index) => (
              <Typography
                key={`${label}-${index}`}
                variant="caption"
                color="text.secondary"
                sx={{
                  gridColumn: 1,
                  gridRow: index + 1,
                  lineHeight: "12px",
                  fontSize: 11
                }}
              >
                {label}
              </Typography>
            ))}
            {cells.map((cell) => {
              const level = getLevel(cell.requests, maxRequests);
              const tooltip = cell.inRange
                ? `${cell.key}: ${formatNumber(cell.requests)} 次调用, ${formatNumber(cell.totalTokens)} tokens${
                    cell.failedRequests ? `, ${formatNumber(cell.failedRequests)} 次失败` : ""
                  }`
                : "";

              return (
                <Tooltip key={cell.key} title={tooltip} arrow disableHoverListener={!cell.inRange}>
                  <Box
                    aria-label={tooltip || undefined}
                    sx={{
                      gridColumn: cell.week + 1,
                      gridRow: cell.day,
                      width: 12,
                      height: 12,
                      borderRadius: 0.5,
                      bgcolor: cell.inRange ? COLORS[level] : "transparent",
                      border: cell.inRange ? "1px solid rgba(15,23,42,0.06)" : "1px solid transparent"
                    }}
                  />
                </Tooltip>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
