import React from "react";
import { Box, useTheme } from "@mui/material";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

export function TokenUsageChart({ data }) {
  const theme = useTheme();
  const chartData = data.map((item) => ({
    ...item,
    label: item.hour.slice(11, 16)
  }));
  const tickColor = theme.palette.text.secondary;
  const tooltipStyle = {
    borderRadius: 8,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    boxShadow: theme.palette.app.shadow
  };

  return (
    <Box sx={{ width: "100%", height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: tickColor }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: tickColor }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <RechartsTooltip
            formatter={(value, name) => {
              const labelMap = {
                promptTokens: "Input Tokens",
                completionTokens: "Output Tokens",
                totalTokens: "总 Tokens",
                requests: "请求数"
              };
              return [Number(value).toLocaleString(), labelMap[name] || name];
            }}
            labelFormatter={(label) => `${label}`}
            contentStyle={tooltipStyle}
            labelStyle={{ color: theme.palette.text.primary }}
            itemStyle={{ color: theme.palette.text.primary }}
          />
          <Legend
            wrapperStyle={{ color: tickColor }}
            formatter={(value) => {
              const labelMap = {
                promptTokens: "Input Tokens",
                completionTokens: "Output Tokens",
                totalTokens: "总 Tokens",
                requests: "请求数"
              };
              return labelMap[value] || value;
            }}
          />
          <Bar dataKey="promptTokens" stackId="a" fill={theme.palette.success.main} radius={[0, 0, 0, 0]} />
          <Bar dataKey="completionTokens" stackId="a" fill={theme.palette.primary.main} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
