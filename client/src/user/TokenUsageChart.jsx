import React from "react";
import { Box } from "@mui/material";
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
  const chartData = data.map((item) => ({
    ...item,
    label: item.hour.slice(11, 16)
  }));

  return (
    <Box sx={{ width: "100%", height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12 }}
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
            contentStyle={{ borderRadius: 8, border: "1px solid #dce3ea" }}
          />
          <Legend
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
          <Bar dataKey="promptTokens" stackId="a" fill="#0f766e" radius={[0, 0, 0, 0]} />
          <Bar dataKey="completionTokens" stackId="a" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
