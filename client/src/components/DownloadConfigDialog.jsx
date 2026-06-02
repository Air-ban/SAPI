import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { CodeBlock } from "./CodeBlock";

export function DownloadConfigDialog({ open, onClose, baseUrl, apiKeys, defaultKey, models, onCopy }) {
  const [tool, setTool] = useState("codex");
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [mainModel, setMainModel] = useState("");
  const [haikuModel, setHaikuModel] = useState("");
  const [sonnetModel, setSonnetModel] = useState("");
  const [opusModel, setOpusModel] = useState("");
  const [codexModel, setCodexModel] = useState("");
  const modelList = (models || []).map((m) => (typeof m === "object" ? m.id : m)).filter(Boolean);
  const keyList = (apiKeys || []).filter((k) => k.enabled !== false && k.key);

  useEffect(() => {
    if (open) {
      if (keyList.length > 0 && !keyList.some((k) => k.id === selectedKeyId)) {
        const defaultEntry = keyList.find((k) => k.key === defaultKey) || keyList[0];
        setSelectedKeyId(defaultEntry.id);
      }
      if (modelList.length > 0) {
        if (!modelList.includes(mainModel)) setMainModel(modelList[0]);
        if (!modelList.includes(haikuModel)) setHaikuModel(modelList[0]);
        if (!modelList.includes(sonnetModel)) setSonnetModel(modelList[0]);
        if (!modelList.includes(opusModel)) setOpusModel(modelList[0]);
        if (!modelList.includes(codexModel)) setCodexModel(modelList[0]);
      }
    }
  }, [open, keyList, selectedKeyId, defaultKey, modelList, mainModel, haikuModel, sonnetModel, opusModel, codexModel]);

  const selectedKey = (keyList.find((k) => k.id === selectedKeyId) || keyList[0] || {}).key || "";
  const endpoint = baseUrl || window.location.origin;

  const claudeScript = [
    "@echo off",
    "echo ==================================================",
    "echo Checking if Claude Code is installed...",
    "echo ==================================================",
    "",
    "where claude >nul 2>nul",
    "if %errorlevel% neq 0 goto FAIL",
    "",
    "echo SUCCESS: Claude Code detected!",
    "echo ==================================================",
    "",
    "set \"CONFIG_DIR=%USERPROFILE%\\.claude\"",
    "set \"CONFIG_PATH=%CONFIG_DIR%\\settings.json\"",
    "",
    "echo Target config path: %CONFIG_PATH%",
    "",
    "if not exist \"%CONFIG_DIR%\" mkdir \"%CONFIG_DIR%\"",
    "",
    "echo Writing configuration file...",
    "",
    `echo { > "%CONFIG_PATH%"`,
    `echo   "env": { >> "%CONFIG_PATH%"`,
    `echo     "ANTHROPIC_BASE_URL": "${endpoint}", >> "%CONFIG_PATH%"`,
    `echo     "ANTHROPIC_AUTH_TOKEN": "${selectedKey}", >> "%CONFIG_PATH%"`,
    `echo     "ANTHROPIC_MODEL": "${mainModel}", >> "%CONFIG_PATH%"`,
    `echo     "ANTHROPIC_DEFAULT_HAIKU_MODEL": "${haikuModel}", >> "%CONFIG_PATH%"`,
    `echo     "ANTHROPIC_DEFAULT_SONNET_MODEL": "${sonnetModel}", >> "%CONFIG_PATH%"`,
    `echo     "ANTHROPIC_DEFAULT_OPUS_MODEL": "${opusModel}" >> "%CONFIG_PATH%"`,
    `echo   }, >> "%CONFIG_PATH%"`,
    `echo   "theme": "dark", >> "%CONFIG_PATH%"`,
    `echo   "includeCoAuthoredBy": false >> "%CONFIG_PATH%"`,
    `echo } >> "%CONFIG_PATH%"`,
    "",
    "echo SUCCESS: Custom configuration written to settings.json!",
    `echo Redirected to ${endpoint} successfully.`,
    "",
    "mshta vbscript:msgbox(\"Configuration completed successfully! Claude Code has been configured.\",64,\"HanGuan's SuperAPI Configurator\")(window.close)",
    "goto END",
    "",
    ":FAIL",
    "echo ERROR: Claude Code not found.",
    "mshta vbscript:msgbox(\"Error: Claude Code is not installed. Please install it first.\",16,\"HanGuan's SuperAPI Configurator\")(window.close)",
    "",
    ":END",
    "echo ==================================================",
    "echo Script execution finished!",
    "pause"
  ].join("\r\n");

  const codexScript = [
    "@echo off",
    "echo ==================================================",
    "echo Checking if Codex is installed...",
    "echo ==================================================",
    "",
    "where codex >nul 2>nul",
    "if %errorlevel% neq 0 goto FAIL",
    "",
    "echo SUCCESS: Codex detected!",
    "echo ==================================================",
    "",
    "set \"CONFIG_DIR=%USERPROFILE%\\.codex\"",
    "set \"CONFIG_PATH=%CONFIG_DIR%\\config.toml\"",
    "set \"AUTH_PATH=%CONFIG_DIR%\\auth.json\"",
    "",
    "echo Target config directory: %CONFIG_DIR%",
    "",
    "if not exist \"%CONFIG_DIR%\" mkdir \"%CONFIG_DIR%\"",
    "",
    "echo Writing config.toml...",
    "",
    `echo model_provider = "custom" > "%CONFIG_PATH%"`,
    `echo model = "${codexModel}" >> "%CONFIG_PATH%"`,
    `echo disable_response_storage = true >> "%CONFIG_PATH%"`,
    `echo model_reasoning_effort = "high" >> "%CONFIG_PATH%"`,
    `echo. >> "%CONFIG_PATH%"`,
    `echo [model_providers] >> "%CONFIG_PATH%"`,
    `echo [windows] >> "%CONFIG_PATH%"`,
    `echo sandbox = "elevated" >> "%CONFIG_PATH%"`,
    `echo [model_providers.custom] >> "%CONFIG_PATH%"`,
    `echo name = "custom" >> "%CONFIG_PATH%"`,
    `echo wire_api = "responses" >> "%CONFIG_PATH%"`,
    `echo requires_openai_auth = true >> "%CONFIG_PATH%"`,
    `echo base_url = "${endpoint}" >> "%CONFIG_PATH%"`,
    "",
    "echo Writing auth.json...",
    "",
    `echo { > "%AUTH_PATH%"`,
    `echo   "OPENAI_API_KEY": "${selectedKey}" >> "%AUTH_PATH%"`,
    `echo } >> "%AUTH_PATH%"`,
    "",
    "echo ==================================================",
    "echo SUCCESS: Custom configuration and auth token written!",
    "echo Configuration completed.",
    "",
    "mshta vbscript:msgbox(\"Configuration completed successfully! config.toml and auth.json have been generated in .codex folder.\",64,\"HanGuan's SuperAPI Configurator\")(window.close)",
    "goto END",
    "",
    ":FAIL",
    "echo ERROR: Codex not found.",
    "mshta vbscript:msgbox(\"Error: Codex is not installed. Please install it first.\",16,\"HanGuan's SuperAPI Configurator\")(window.close)",
    "",
    ":END",
    "echo ==================================================",
    "echo Script execution finished!",
    "pause"
  ].join("\r\n");

  const script = tool === "codex" ? codexScript : claudeScript;
  const filename = tool === "codex" ? "setup-codex.bat" : "setup-claude-code.bat";

  const handleDownload = () => {
    const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>下载配置脚本</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <FormControl>
            <InputLabel>API Key</InputLabel>
            <Select
              value={selectedKeyId}
              label="API Key"
              onChange={(e) => setSelectedKeyId(e.target.value)}
              disabled={keyList.length === 0}
            >
              {keyList.map((k) => (
                <MenuItem key={k.id} value={k.id}>
                  {k.name || "API Key"} — {k.key.slice(0, 12)}...
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl>
            <InputLabel>工具</InputLabel>
            <Select value={tool} label="工具" onChange={(e) => setTool(e.target.value)}>
              <MenuItem value="codex">Codex CLI (OpenAI)</MenuItem>
              <MenuItem value="claude">Claude Code (Anthropic)</MenuItem>
            </Select>
          </FormControl>

          {tool === "claude" ? (
            <>
              <Alert severity="info" sx={{ fontSize: "0.82rem" }}>
                脚本会检测 Claude Code 是否已安装，然后直接将配置写入 <code>%USERPROFILE%\.claude\settings.json</code>。
              </Alert>
              <FormControl>
                <InputLabel>主模型 (ANTHROPIC_MODEL)</InputLabel>
                <Select
                  value={mainModel}
                  label="主模型 (ANTHROPIC_MODEL)"
                  onChange={(e) => setMainModel(e.target.value)}
                  disabled={modelList.length === 0}
                >
                  {modelList.map((id) => (
                    <MenuItem key={id} value={id}>{id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <InputLabel>Haiku 模型</InputLabel>
                <Select
                  value={haikuModel}
                  label="Haiku 模型"
                  onChange={(e) => setHaikuModel(e.target.value)}
                  disabled={modelList.length === 0}
                >
                  {modelList.map((id) => (
                    <MenuItem key={id} value={id}>{id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <InputLabel>Sonnet 模型</InputLabel>
                <Select
                  value={sonnetModel}
                  label="Sonnet 模型"
                  onChange={(e) => setSonnetModel(e.target.value)}
                  disabled={modelList.length === 0}
                >
                  {modelList.map((id) => (
                    <MenuItem key={id} value={id}>{id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <InputLabel>Opus 模型</InputLabel>
                <Select
                  value={opusModel}
                  label="Opus 模型"
                  onChange={(e) => setOpusModel(e.target.value)}
                  disabled={modelList.length === 0}
                >
                  {modelList.map((id) => (
                    <MenuItem key={id} value={id}>{id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          ) : (
            <>
              <Alert severity="info" sx={{ fontSize: "0.82rem" }}>
                脚本会检测 Codex 是否已安装，然后写入 <code>%USERPROFILE%\.codex\config.toml</code> 和 <code>auth.json</code>。
              </Alert>
              <FormControl>
                <InputLabel>模型</InputLabel>
                <Select
                  value={codexModel}
                  label="模型"
                  onChange={(e) => setCodexModel(e.target.value)}
                  disabled={modelList.length === 0}
                >
                  {modelList.map((id) => (
                    <MenuItem key={id} value={id}>{id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
              脚本预览
            </Typography>
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                bgcolor: "#1e293b",
                color: "#e2e8f0",
                fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
                fontSize: "0.78rem",
                lineHeight: 1.7,
                whiteSpace: "pre",
                overflow: "auto",
                maxHeight: 300
              }}
            >
              {script}
            </Paper>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={() => { onCopy(script); }}>复制脚本</Button>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="contained" startIcon={<DownloadIcon />} onClick={handleDownload}>
          下载 .bat
        </Button>
      </DialogActions>
    </Dialog>
  );
}
