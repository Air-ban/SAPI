import React, { useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography
} from "@mui/material";

export function ForgotPasswordDialog({ open, onClose, onSendCode, onReset, onToast }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setEmail("");
      setCode("");
      setPassword("");
      setConfirmPassword("");
      setCountdown(0);
    }
  }, [open]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendCode = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      onToast("请输入有效的邮箱地址", "warning");
      return;
    }
    setCodeLoading(true);
    try {
      await onSendCode(email);
      setCountdown(60);
      onToast("验证码已发送，请检查收件箱和垃圾邮件文件夹", "success");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setCodeLoading(false);
    }
  };

  const handleReset = async () => {
    if (password !== confirmPassword) {
      onToast("两次输入的密码不一致", "warning");
      return;
    }
    if (password.length < 8) {
      onToast("密码至少 8 个字符", "warning");
      return;
    }

    setLoading(true);
    try {
      await onReset(email, code, password);
      onToast("密码重置成功，请登录", "success");
      onClose();
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>重置密码</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {step === 1 ? (
            <>
              <Typography variant="body2" color="text.secondary">
                输入注册时使用的邮箱地址，我们将发送验证码用于重置密码。如未收到，请检查垃圾邮件文件夹。
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  label="邮箱"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your-email@example.com"
                  sx={{ flex: 1 }}
                  autoFocus
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
              <TextField
                label="验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6 位数字"
              />
              <Button
                variant="contained"
                onClick={() => {
                  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    onToast("请输入有效的邮箱地址", "warning");
                    return;
                  }
                  if (!/^\d{6}$/.test(code)) {
                    onToast("请输入 6 位数字验证码", "warning");
                    return;
                  }
                  setStep(2);
                }}
              >
                下一步
              </Button>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                请设置新密码。
              </Typography>
              <TextField
                label="新密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText="至少 8 个字符。"
                autoFocus
              />
              <TextField
                label="确认新密码"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <Stack direction="row" spacing={1}>
                <Button onClick={() => setStep(1)} color="inherit">上一步</Button>
                <Button
                  variant="contained"
                  onClick={handleReset}
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} /> : null}
                >
                  重置密码
                </Button>
              </Stack>
            </>
          )}

        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">取消</Button>
      </DialogActions>
    </Dialog>
  );
}
