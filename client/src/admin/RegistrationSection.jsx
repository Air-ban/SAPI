import React, { useEffect, useState } from "react";
import { Alert, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import { Section } from "../components/Section";
import { request } from "../utils/api";

export function RegistrationSection({ registrationDisabled, afterChange, onToast }) {
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDisabled(Boolean(registrationDisabled));
  }, [registrationDisabled]);

  const toggleRegistration = async () => {
    const nextDisabled = !disabled;
    setLoading(true);
    try {
      const result = await request("/api/admin/registration", {
        method: "PUT",
        body: { registrationDisabled: nextDisabled }
      });
      setDisabled(Boolean(result?.registrationDisabled));
      await afterChange(nextDisabled ? "注册功能已关闭" : "注册功能已开启", { refreshPublicConfig: true });
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section
      title="注册功能"
      icon={<PersonAddIcon />}
      action={
        <Chip
          label={disabled ? "已关闭" : "开放中"}
          color={disabled ? "warning" : "success"}
          variant="outlined"
          size="small"
        />
      }
    >
      <Stack spacing={2}>
        <Alert severity={disabled ? "warning" : "success"} variant="outlined">
          {disabled ? "新用户注册已关闭，已有用户和管理员仍可登录。" : "新用户可通过邮箱或 GitHub 注册。"}
        </Alert>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {disabled ? "点击开启后将恢复普通邮箱、邀请码、教育邮箱和 GitHub 新用户注册。" : "点击关闭后将阻止普通邮箱、邀请码、教育邮箱和 GitHub 新用户注册。"}
          </Typography>
          <Button
            variant={disabled ? "contained" : "outlined"}
            color={disabled ? "success" : "warning"}
            startIcon={loading ? <CircularProgress size={16} /> : disabled ? <PersonAddIcon /> : <BlockIcon />}
            onClick={toggleRegistration}
            disabled={loading}
            sx={{ flexShrink: 0 }}
          >
            {disabled ? "开启注册" : "关闭注册"}
          </Button>
        </Stack>
      </Stack>
    </Section>
  );
}
