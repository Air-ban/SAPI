import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import LoginIcon from "@mui/icons-material/Login";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import GitHubIcon from "@mui/icons-material/GitHub";
import { ForgotPasswordDialog } from "../components/ForgotPasswordDialog";
import { DividerLine } from "../components/DividerLine";
import { ThemeModeToggle } from "../components/ThemeModeToggle";

export function AuthPage({
  mode,
  onLogin,
  onRegister,
  onSendCode,
  onSendForgotCode,
  onResetPassword,
  onNavigate,
  onToast,
  themeMode,
  onToggleThemeMode,
  publicConfig
}) {
  const isRegister = mode === "register";
  const githubEnabled = Boolean(publicConfig?.github?.enabled);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    verificationCode: "",
    invitationCode: ""
  });
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [registerMethod, setRegisterMethod] = useState("edu");
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    setAgreed(false);
  }, [mode]);

  const sendCode = async () => {
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      onToast("请输入有效的邮箱地址", "warning");
      return;
    }
    setCodeLoading(true);
    try {
      await onSendCode(form.email, "register");
      setCountdown(60);
      onToast("验证码已发送，请检查收件箱和垃圾邮件文件夹", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setCodeLoading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();

    if (isRegister && !agreed) {
      onToast("请先同意用户协议和隐私政策", "warning");
      return;
    }

    if (isRegister) {
      if (form.password !== form.confirmPassword) {
        onToast("两次输入的密码不一致", "warning");
        return;
      }
      if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        onToast("请输入有效的邮箱地址", "warning");
        return;
      }
      if (registerMethod === "edu" && !form.email.endsWith(".edu.cn")) {
        onToast("教育邮箱注册需要使用 .edu.cn 后缀的邮箱", "warning");
        return;
      }
      if (registerMethod === "invite" && !form.invitationCode.trim()) {
        onToast("请输入邀请码", "warning");
        return;
      }
      if (!/^\d{6}$/.test(form.verificationCode)) {
        onToast("验证码为 6 位数字", "warning");
        return;
      }
    }

    setLoading(true);
    try {
      if (isRegister) {
        await onRegister({
          username: form.username,
          email: form.email,
          password: form.password,
          verificationCode: form.verificationCode,
          invitationCode: form.invitationCode
        });
      } else {
        await onLogin({
          username: form.username,
          password: form.password
        });
      }
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Box
        sx={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          px: 2,
          py: 4,
          bgcolor: "background.default"
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            width: "100%",
            maxWidth: 440,
            p: { xs: 2.25, sm: 3 },
            boxShadow: (theme) => theme.palette.app.shadow,
            bgcolor: "background.paper"
          }}
        >
          <Stack spacing={2.2}>
            <Stack direction="row" justifyContent="flex-end">
              <ThemeModeToggle mode={themeMode} onToggle={onToggleThemeMode} />
            </Stack>
            <Stack spacing={1} alignItems="center" textAlign="center">
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: 1.25,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "primary.main",
                  color: "primary.contrastText"
                }}
              >
                {isRegister ? <PersonAddIcon /> : <LoginIcon />}
              </Box>
              <Box>
                <Typography variant="h5">
                  {isRegister ? "创建 SAPI 账号" : "登录 SAPI"}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {isRegister
                    ? "进入 AI SDK Gateway 控制台，自助创建 API Key。"
                    : "登录 AI SDK Gateway 控制台。"}
                </Typography>
              </Box>
            </Stack>

            <Box component="form" onSubmit={submit}>
              <Stack spacing={1.5}>
                <TextField
                  label={isRegister ? "用户名" : "用户名或邮箱"}
                  value={form.username}
                  onChange={update("username")}
                  autoComplete="username"
                  placeholder={isRegister ? "字母、数字、点、下划线、@、短横线" : "用户名或邮箱"}
                  required
                />
                {isRegister ? (
                  <TextField
                    label="邮箱"
                    type="email"
                    value={form.email}
                    onChange={update("email")}
                    placeholder="your-email@example.com"
                    helperText="验证码可能会进入垃圾邮件，请注意查收。"
                    required
                  />
                ) : null}
                <TextField
                  label="密码"
                  type="password"
                  value={form.password}
                  onChange={update("password")}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  required
                  helperText={isRegister ? "至少 8 个字符。" : ""}
                />
                {isRegister ? (
                  <TextField
                    label="确认密码"
                    type="password"
                    value={form.confirmPassword}
                    onChange={update("confirmPassword")}
                    autoComplete="new-password"
                    required
                  />
                ) : null}
                {isRegister ? (
                  <Stack direction="row" spacing={1}>
                    <TextField
                      label="邮箱验证码"
                      value={form.verificationCode}
                      onChange={update("verificationCode")}
                      placeholder="6 位数字"
                      required
                      sx={{ flex: 1 }}
                    />
                    <Button
                      variant="outlined"
                      onClick={sendCode}
                      disabled={codeLoading || countdown > 0}
                      sx={{ minWidth: 120, height: 56 }}
                    >
                      {countdown > 0 ? `${countdown} 秒` : "获取验证码"}
                    </Button>
                  </Stack>
                ) : null}
                {isRegister ? (
                  <>
                    <DividerLine />
                    <ToggleButtonGroup
                      value={registerMethod}
                      exclusive
                      fullWidth
                      size="small"
                      onChange={(_, value) => {
                        if (value) setRegisterMethod(value);
                      }}
                    >
                      <ToggleButton value="edu">教育邮箱注册</ToggleButton>
                      <ToggleButton value="invite">邀请码注册</ToggleButton>
                    </ToggleButtonGroup>
                    {registerMethod === "invite" ? (
                      <TextField
                        label="邀请码"
                        value={form.invitationCode}
                        onChange={update("invitationCode")}
                        placeholder="输入管理员提供的邀请码"
                        required
                        helperText="使用管理员提供的邀请码进行注册。"
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            bgcolor: 'app.paperAlt'
                          }
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        使用 .edu.cn 教育邮箱注册，无需邀请码。
                      </Typography>
                    )}
                  </>
                ) : null}
                {isRegister ? (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2" color="text.secondary">
                        我已阅读并同意
                        <Button size="small" sx={{ p: 0, minWidth: 0, verticalAlign: "baseline" }} onClick={() => setTermsOpen(true)}>
                          《用户协议与隐私政策》
                        </Button>
                      </Typography>
                    }
                  />
                ) : null}
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  startIcon={isRegister ? <PersonAddIcon /> : <LoginIcon />}
                  disabled={loading}
                >
                  {isRegister ? "注册" : "登录"}
                </Button>
                {githubEnabled ? (
                  <Button
                    variant="outlined"
                    size="large"
                    startIcon={<GitHubIcon />}
                    onClick={() => {
                      window.location.href = "/api/auth/github/start";
                    }}
                  >
                    使用 GitHub 登录
                  </Button>
                ) : null}
                {!isRegister ? (
                  <Box sx={{ textAlign: "center" }}>
                    <Button size="small" onClick={() => setForgotOpen(true)}>
                      忘记密码？
                    </Button>
                  </Box>
                ) : null}
              </Stack>
            </Box>

            <DividerLine />
            <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap">
              <Button
                size="small"
                onClick={() => onNavigate(isRegister ? "login" : "register")}
              >
                {isRegister ? "已有账号，去登录" : "没有账号，去注册"}
              </Button>
              <Button size="small" color="inherit" onClick={() => onNavigate("home")}>
                返回首页
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Box>
      <ForgotPasswordDialog
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        onSendCode={onSendForgotCode}
        onReset={onResetPassword}
        onToast={onToast}
      />
      <Dialog open={termsOpen} onClose={() => setTermsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>用户协议与隐私政策</DialogTitle>
        <DialogContent>
          <DialogContentText component="div" sx={{ whiteSpace: "pre-line" }}>
            <Typography variant="subtitle2" gutterBottom>一、用户协议</Typography>
            <Typography variant="body2" paragraph>
              1. 服务说明：本服务提供 API 代理转发功能，用户可通过创建 API Key 调用第三方大模型服务。
            </Typography>
            <Typography variant="body2" paragraph>
              2. 使用规范：用户不得利用本服务从事违法违规活动，不得滥用 API 接口。
            </Typography>
            <Typography variant="body2" paragraph>
              3. 数据承诺：我们不会将用户的任何数据（包括但不限于 API 请求内容、响应内容、用量数据）用于训练人工智能模型或任何机器学习目的。
            </Typography>
            <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>二、隐私政策</Typography>
            <Typography variant="body2" paragraph>
              1. 信息收集：我们仅收集提供服务所必需的最少信息，包括用户名、邮箱地址、密码哈希及 API 用量统计。
            </Typography>
            <Typography variant="body2" paragraph>
              2. 隐私保护：模型转发请求会保存用户提交的请求 JSON 内容 7 天，用于用量核对、故障排查和安全审计；响应正文不会持久化保存。
            </Typography>
            <Typography variant="body2" paragraph>
              3. 数据安全：用户数据采用加密存储，仅用于身份验证、用量统计和服务运营，不会向任何第三方披露或出售。
            </Typography>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTermsOpen(false)}>关闭</Button>
          <Button
            variant="contained"
            onClick={() => {
              setAgreed(true);
              setTermsOpen(false);
            }}
          >
            同意
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
