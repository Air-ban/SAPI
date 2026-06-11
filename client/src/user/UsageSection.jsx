import React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Collapse,
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
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { EmptyState } from "../components/EmptyState";
import { Metric } from "../components/Metric";
import { Section } from "../components/Section";
import { RequestHeatmap } from "./RequestHeatmap";
import {
  cacheHitText,
  formatDate,
  formatDuration,
  formatMoneyFromMicrounits,
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

export function UsageSection({ usage, onLoadRequestContent, privacyMode = false }) {
  if (!usage) return null;
  const hasData = usage.requests > 0;
  const recentRequests = usage.recentRequests || usage.recent || [];
  const showUserColumn = recentRequests.some((request) => request.userName || request.username || request.userId);
  const showKeyColumn = recentRequests.some((request) => request.apiKeyName || request.apiKeyPreview || request.apiKeyId);
  const showIPInfoColumn = !privacyMode && recentRequests.some((request) => request.clientIpInfo?.ip || request.clientIpInfo?.lookupStatus);
  const showDeviceColumn = !privacyMode && recentRequests.some((request) => request.clientDevice?.userAgent || request.clientDevice?.browserName || request.clientDevice?.platform);
  const showRequestContentColumn = !privacyMode;

  return (
    <Section title="Token 用量统计（近 30 天）" icon={<BarChartIcon />}>
      {!hasData ? (
        <EmptyState text="暂无调用记录。" />
      ) : (
        <Stack spacing={2}>
          {usage.byDay.length > 0 ? (
            <Paper variant="outlined" sx={statCardSx}>
              <RequestHeatmap data={usage.byDay} title="每日调用次数" />
            </Paper>
          ) : null}

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(5, minmax(0, 1fr))" },
              gap: 2
            }}
          >
            <Metric icon={<AnalyticsIcon />} label="总请求数" value={usage.requests} />
            <Metric icon={<DnsIcon />} label="Input Tokens" value={formatNumber(usage.totalPromptTokens)} />
            <Metric icon={<RocketLaunchIcon />} label="Output Tokens" value={formatNumber(usage.totalCompletionTokens)} />
            <Metric icon={<CheckCircleIcon />} label="缓存命中 Tokens" value={formatNumber(usage.totalCachedTokens)} />
            <Metric icon={<BarChartIcon />} label="额度消耗" value={formatMoneyFromMicrounits(usage.totalBillableMicrounits)} />
          </Box>

          <Stack spacing={1.25}>
            {(usage.byApiKey || []).length > 0 ? (
              <StatsAccordion title="按 API Key 统计" count={usage.byApiKey.length}>
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
                          <TableCell align="right">额度消耗</TableCell>
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
                            <TableCell align="right">{formatMoneyFromMicrounits(row.billableMicrounits)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </StatsAccordion>
            ) : null}

            {usage.byModel.length > 0 ? (
              <StatsAccordion title="按模型统计" count={usage.byModel.length}>
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
                          <TableCell align="right">额度消耗</TableCell>
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
                            <TableCell align="right">{formatMoneyFromMicrounits(row.billableMicrounits)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </StatsAccordion>
            ) : null}

            {usage.byDay.length > 0 ? (
              <StatsAccordion title="按天统计" count={Math.min(usage.byDay.length, 14)}>
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
                          <TableCell align="right">额度消耗</TableCell>
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
                            <TableCell align="right">{formatMoneyFromMicrounits(row.billableMicrounits)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </StatsAccordion>
            ) : null}
          </Stack>

          {recentRequests.length > 0 ? (
            <Paper variant="outlined" sx={{ p: 2, overflow: "hidden" }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 780 }}>
                最近请求记录
              </Typography>
              <TableContainer sx={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <Table size="small" sx={{ minWidth: showUserColumn || showKeyColumn || showIPInfoColumn || showDeviceColumn || showRequestContentColumn ? 1580 : 1060 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>时间</TableCell>
                      {showUserColumn ? <TableCell>用户</TableCell> : null}
                      {showKeyColumn ? <TableCell>API Key</TableCell> : null}
                      {showIPInfoColumn ? <TableCell>IP 情报</TableCell> : null}
                      {showDeviceColumn ? <TableCell>设备</TableCell> : null}
                      <TableCell>状态</TableCell>
                      <TableCell>模型</TableCell>
                      <TableCell>端点</TableCell>
                      <TableCell align="right">输入</TableCell>
                      <TableCell align="right">输出</TableCell>
                      <TableCell align="right">缓存命中</TableCell>
                      <TableCell align="right">缓存写入</TableCell>
                      <TableCell align="right">总 Tokens</TableCell>
                      <TableCell align="right">额度消耗</TableCell>
                      <TableCell align="right">耗时</TableCell>
                      {showRequestContentColumn ? <TableCell>请求 JSON</TableCell> : null}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {recentRequests.map((request) => (
                        <RecentRequestRow
                          key={request.id}
                          request={request}
                          showUserColumn={showUserColumn}
                          showKeyColumn={showKeyColumn}
                          showIPInfoColumn={showIPInfoColumn}
                          showDeviceColumn={showDeviceColumn}
                          showRequestContentColumn={showRequestContentColumn}
                          onLoadRequestContent={privacyMode ? undefined : onLoadRequestContent}
                        />
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

function StatsAccordion({ title, count, children }) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        borderRadius: 1,
        overflow: "hidden",
        "&:before": { display: "none" }
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2" sx={{ fontWeight: 780 }}>
            {title}
          </Typography>
          <Chip size="small" label={`${count} 项`} variant="outlined" />
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0, px: 2, pb: 2 }}>
        {children}
      </AccordionDetails>
    </Accordion>
  );
}

function RecentRequestRow({
  request,
  showUserColumn,
  showKeyColumn,
  showIPInfoColumn,
  showDeviceColumn,
  showRequestContentColumn,
  onLoadRequestContent
}) {
  const [open, setOpen] = React.useState(false);
  const [requestContent, setRequestContent] = React.useState(request.requestContent || null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestJson = stringifyRequestContent(requestContent);
  const hasRequestJson = requestJson !== "";
  const canLoadRequestJson = Boolean(request.hasRequestContent && onLoadRequestContent && request.id);

  const handleToggleRequestJson = async () => {
    if (hasRequestJson) {
      setOpen((current) => !current);
      return;
    }
    if (!canLoadRequestJson || loading) return;
    setLoading(true);
    setError("");
    try {
      const loaded = await onLoadRequestContent(request.id);
      setRequestContent(loaded || {});
      setOpen(true);
    } catch (err) {
      setError(err.message || "请求 JSON 加载失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <TableRow hover title={request.errorMessage || ""}>
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
        {showIPInfoColumn ? (
          <TableCell>
            <IPInfoSummary info={request.clientIpInfo} />
          </TableCell>
        ) : null}
        {showDeviceColumn ? (
          <TableCell>
            <DeviceSummary device={request.clientDevice} />
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
          <Typography variant="body2" sx={{ fontFamily: 'Consolas, monospace' }} noWrap title={request.upstreamModel ? `${request.model} -> ${request.upstreamModel}` : request.model}>
            {request.model || "unknown"}
            {request.upstreamModel && request.upstreamModel !== request.model ? (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                {" -> "}{request.upstreamModel}
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
        <TableCell align="right">{formatMoneyFromMicrounits(request.billableMicrounits)}</TableCell>
        <TableCell align="right">{formatDuration(request.durationMs)}</TableCell>
        {showRequestContentColumn ? (
          <TableCell>
            {hasRequestJson || canLoadRequestJson ? (
              <Button size="small" variant="outlined" onClick={handleToggleRequestJson} disabled={loading}>
                {open ? "收起" : "查看"}
              </Button>
            ) : error ? (
              <Typography variant="body2" color="error" title={error}>加载失败</Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">-</Typography>
            )}
          </TableCell>
        ) : null}
      </TableRow>
      {showRequestContentColumn && (hasRequestJson || error) ? (
        <TableRow>
          <TableCell colSpan={11 + (showRequestContentColumn ? 1 : 0) + (showUserColumn ? 1 : 0) + (showKeyColumn ? 1 : 0) + (showIPInfoColumn ? 1 : 0) + (showDeviceColumn ? 1 : 0)} sx={{ p: 0, borderBottom: open ? undefined : 0 }}>
            <Collapse in={open || Boolean(error)} timeout="auto" unmountOnExit>
              <Box
                component={error ? "div" : "pre"}
                sx={{
                  m: 1.5,
                  p: 1.5,
                  maxHeight: 260,
                  overflow: "auto",
                  borderRadius: 1,
                  bgcolor: "app.codeBg",
                  color: "app.codeText",
                  fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere"
                }}
              >
                {error || requestJson}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function DeviceSummary({ device }) {
  if (!device) {
    return <Typography variant="body2" color="text.secondary">-</Typography>;
  }
  const browser = [device.browserName, shortVersion(device.browserVersion)].filter(Boolean).join(" ");
  const platform = [device.osName || device.platform, shortVersion(device.osVersion)].filter(Boolean).join(" ");
  const languages = Array.isArray(device.languages) ? device.languages.slice(0, 2).join(", ") : "";
  const meta = [platform, device.deviceType, languages].filter(Boolean).join(" · ");

  return (
    <Stack spacing={0.5} sx={{ minWidth: 170, maxWidth: 260 }}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flexWrap: "wrap" }}>
        <Typography variant="body2" sx={{ fontWeight: 760 }} noWrap title={device.userAgent || deviceTitle(device)}>
          {browser || device.platform || "Unknown client"}
        </Typography>
        {device.mobile ? <Chip size="small" label="mobile" variant="outlined" /> : null}
        {device.bot ? <Chip size="small" label="bot" color="warning" variant="outlined" /> : null}
      </Stack>
      <Typography variant="caption" color="text.secondary" noWrap title={deviceTitle(device)}>
        {meta || device.userAgent || "-"}
      </Typography>
    </Stack>
  );
}

function shortVersion(value) {
  if (!value) return "";
  return String(value).split(".").slice(0, 2).join(".");
}

function deviceTitle(device) {
  if (!device) return "";
  return [
    device.browserName ? `浏览器: ${[device.browserName, device.browserVersion].filter(Boolean).join(" ")}` : "",
    device.osName || device.platform ? `系统: ${[device.osName || device.platform, device.osVersion].filter(Boolean).join(" ")}` : "",
    device.deviceType ? `设备类型: ${device.deviceType}` : "",
    device.deviceModel ? `设备型号: ${device.deviceModel}` : "",
    device.architecture ? `架构: ${device.architecture}` : "",
    device.languages?.length ? `语言: ${device.languages.join(", ")}` : "",
    device.origin ? `Origin: ${device.origin}` : "",
    device.referrer ? `Referrer: ${device.referrer}` : "",
    device.userAgent ? `UA: ${device.userAgent}` : ""
  ].filter(Boolean).join("\n");
}

function IPInfoSummary({ info }) {
  if (!info) {
    return <Typography variant="body2" color="text.secondary">-</Typography>;
  }
  const location = primaryLocation(info);
  const attributes = Array.isArray(info.ipAttributes) ? info.ipAttributes.slice(0, 2) : [];
  const score = typeof info.ipPureScore === "number" ? info.ipPureScore : null;
  const status = info.lookupStatus && !["ok", "cached", "local"].includes(info.lookupStatus) ? info.lookupStatus : "";

  return (
    <Stack spacing={0.5} sx={{ minWidth: 180, maxWidth: 260 }}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flexWrap: "wrap" }}>
        <Typography
          variant="body2"
          sx={{ fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace', fontWeight: 760 }}
          noWrap
          title={info.ip || info.lookupIp || ""}
        >
          {info.ip || info.lookupIp || "-"}
        </Typography>
        {score !== null ? <Chip size="small" label={`IPPure ${formatIPScore(score)}`} variant="outlined" /> : null}
        {status ? <Chip size="small" label={status} color="warning" variant="outlined" /> : null}
      </Stack>
      <Typography variant="caption" color="text.secondary" noWrap title={ipInfoTitle(info, location)}>
        {[info.asn ? `ASN ${info.asn}` : "", info.asDomain || info.asName || "", location].filter(Boolean).join(" · ") || info.networkScope || "-"}
      </Typography>
      {attributes.length > 0 ? (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
          {attributes.map((item) => (
            <Chip key={item} size="small" label={item} variant="outlined" />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function primaryLocation(info) {
  const locations = Array.isArray(info?.locations) ? info.locations : [];
  const best = locations.find((item) => item?.provider !== "trusted_proxy_header") || locations[0];
  if (!best) return "";
  return [best.country, best.region, best.city, best.district].filter(Boolean).join("/");
}

function ipInfoTitle(info, location) {
  if (!info) return "";
  return [
    info.ip ? `IP: ${info.ip}` : "",
    info.asn ? `ASN: ${info.asn}` : "",
    info.asDomain ? `AS 域名: ${info.asDomain}` : "",
    info.ipRange ? `IP 范围: ${info.ipRange}` : "",
    location ? `位置: ${location}` : "",
    info.ipSource ? `来源: ${info.ipSource}` : "",
    info.lookupError ? `查询错误: ${info.lookupError}` : ""
  ].filter(Boolean).join("\n");
}

function formatIPScore(value) {
  if (!Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function stringifyRequestContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  if (!Object.keys(value).length) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
