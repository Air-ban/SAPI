import React from "react";
import {
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import BarChartIcon from "@mui/icons-material/BarChart";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DnsIcon from "@mui/icons-material/Dns";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { EmptyState } from "../components/EmptyState";
import { Metric } from "../components/Metric";
import { Section } from "../components/Section";
import {
  cacheHitText,
  formatDate,
  formatDuration,
  formatNumber,
  formatUserName,
  requestStatusColor
} from "../utils/helpers";

const statCardSx = {
  p: 2,
  overflow: "hidden"
};

const tableScrollSx = {
  "& .MuiTableContainer-root": {
    overflowX: "auto",
    WebkitOverflowScrolling: "touch"
  }
};

export function UsageSection({ usage }) {
  if (!usage) return null;
  const hasData = usage.requests > 0;
  const recentRequests = usage.recentRequests || usage.recent || [];
  const showUserColumn = recentRequests.some((request) => request.userName || request.username || request.userId);
  const showKeyColumn = recentRequests.some((request) => request.apiKeyName || request.apiKeyPreview || request.apiKeyId);

  return (
    <Section title="Token 用量统计（近 30 天）" icon={<BarChartIcon />}>
      {!hasData ? (
        <EmptyState text="暂无调用记录。" />
      ) : (
        <Stack spacing={2}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
              gap: 2
            }}
          >
            <Metric icon={<AnalyticsIcon />} label="总请求数" value={usage.requests} />
            <Metric icon={<DnsIcon />} label="Input Tokens" value={formatNumber(usage.totalPromptTokens)} />
            <Metric icon={<RocketLaunchIcon />} label="Output Tokens" value={formatNumber(usage.totalCompletionTokens)} />
            <Metric icon={<CheckCircleIcon />} label="缓存命中 Tokens" value={formatNumber(usage.totalCachedTokens)} />
          </Box>

          <Stack spacing={2}>
            {(usage.byApiKey || []).length > 0 ? (
              <Paper variant="outlined" sx={statCardSx}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 780 }}>
                  按 API Key 统计
                </Typography>
                <Box sx={tableScrollSx}>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>API Key</TableCell>
                          <TableCell>用户</TableCell>
                          <TableCell align="right">请求</TableCell>
                          <TableCell align="right">输入</TableCell>
                          <TableCell align="right">输出</TableCell>
                          <TableCell align="right">Tokens</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {usage.byApiKey.map((row) => (
                          <TableRow key={`${row.userId}-${row.apiKeyId || row.apiKeyPreview}`} hover>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 760 }} noWrap title={row.apiKeyName}>
                                {row.apiKeyName || "未知 Key"}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" noWrap title={row.apiKeyPreview}>
                                {row.apiKeyPreview || "-"}
                              </Typography>
                            </TableCell>
                            <TableCell>{formatUserName(row)}</TableCell>
                            <TableCell align="right">{row.requests}</TableCell>
                            <TableCell align="right">{formatNumber(row.promptTokens)}</TableCell>
                            <TableCell align="right">{formatNumber(row.completionTokens)}</TableCell>
                            <TableCell align="right">{formatNumber(row.totalTokens)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </Paper>
            ) : null}

            {usage.byModel.length > 0 ? (
              <Paper variant="outlined" sx={statCardSx}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 780 }}>
                  按模型统计
                </Typography>
                <Box sx={tableScrollSx}>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>模型</TableCell>
                          <TableCell align="right">请求</TableCell>
                          <TableCell align="right">输入</TableCell>
                          <TableCell align="right">输出</TableCell>
                          <TableCell align="right">缓存命中</TableCell>
                          <TableCell align="right">Tokens</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {usage.byModel.map((row) => (
                          <TableRow key={row.model} hover>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontFamily: 'Consolas, monospace' }} noWrap>
                                {row.model}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">{row.requests}</TableCell>
                            <TableCell align="right">{formatNumber(row.promptTokens)}</TableCell>
                            <TableCell align="right">{formatNumber(row.completionTokens)}</TableCell>
                            <TableCell align="right">{formatNumber(row.cachedTokens)}</TableCell>
                            <TableCell align="right">{formatNumber(row.totalTokens)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </Paper>
            ) : null}

            {usage.byDay.length > 0 ? (
              <Paper variant="outlined" sx={statCardSx}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 780 }}>
                  按天统计
                </Typography>
                <Box sx={tableScrollSx}>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>日期</TableCell>
                          <TableCell align="right">请求</TableCell>
                          <TableCell align="right">输入</TableCell>
                          <TableCell align="right">输出</TableCell>
                          <TableCell align="right">缓存命中</TableCell>
                          <TableCell align="right">Tokens</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {usage.byDay.slice(-14).map((row) => (
                          <TableRow key={row.day} hover>
                            <TableCell>{row.day}</TableCell>
                            <TableCell align="right">{row.requests}</TableCell>
                            <TableCell align="right">{formatNumber(row.promptTokens)}</TableCell>
                            <TableCell align="right">{formatNumber(row.completionTokens)}</TableCell>
                            <TableCell align="right">{formatNumber(row.cachedTokens)}</TableCell>
                            <TableCell align="right">{formatNumber(row.totalTokens)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </Paper>
            ) : null}
          </Stack>

          {recentRequests.length > 0 ? (
            <Paper variant="outlined" sx={{ p: 2, overflow: "hidden" }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 780 }}>
                最近请求记录
              </Typography>
              <TableContainer sx={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <Table size="small" sx={{ minWidth: showUserColumn || showKeyColumn ? 1200 : 960 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>时间</TableCell>
                      {showUserColumn ? <TableCell>用户</TableCell> : null}
                      {showKeyColumn ? <TableCell>API Key</TableCell> : null}
                      <TableCell>状态</TableCell>
                      <TableCell>模型</TableCell>
                      <TableCell>端点</TableCell>
                      <TableCell align="right">输入</TableCell>
                      <TableCell align="right">输出</TableCell>
                      <TableCell align="right">缓存命中</TableCell>
                      <TableCell align="right">缓存写入</TableCell>
                      <TableCell align="right">总 Tokens</TableCell>
                      <TableCell align="right">耗时</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentRequests.map((request) => (
                      <TableRow key={request.id} hover title={request.errorMessage || ""}>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(request.timestamp)}</TableCell>
                        {showUserColumn ? (
                          <TableCell>
                            {formatUserName(request)}
                          </TableCell>
                        ) : null}
                        {showKeyColumn ? (
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 760 }} noWrap title={request.apiKeyName}>
                              {request.apiKeyName || "-"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap title={request.apiKeyPreview}>
                              {request.apiKeyPreview || ""}
                            </Typography>
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <Chip
                            size="small"
                            label={request.status || (request.ok ? "OK" : "ERR")}
                            color={requestStatusColor(request)}
                            variant={request.ok ? "outlined" : "filled"}
                            sx={{ fontWeight: 800, minWidth: 62 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'Consolas, monospace' }} noWrap title={request.upstreamModel ? `${request.model} → ${request.upstreamModel}` : request.model}>
                            {request.model || "unknown"}
                            {request.upstreamModel && request.upstreamModel !== request.model ? (
                              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                → {request.upstreamModel}
                              </Typography>
                            ) : null}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                            {request.method ? <Chip size="small" label={request.method} variant="outlined" /> : null}
                            {request.stream ? <Chip size="small" label="stream" color="secondary" variant="outlined" /> : null}
                            <Typography variant="body2" noWrap title={request.endpoint}>
                              {request.endpoint || "-"}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">{formatNumber(request.promptTokens)}</TableCell>
                        <TableCell align="right">{formatNumber(request.completionTokens)}</TableCell>
                        <TableCell align="right">{cacheHitText(request)}</TableCell>
                        <TableCell align="right">{formatNumber(request.cacheCreationTokens)}</TableCell>
                        <TableCell align="right">{formatNumber(request.totalTokens)}</TableCell>
                        <TableCell align="right">{formatDuration(request.durationMs)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          ) : null}
        </Stack>
      )}
    </Section>
  );
}
