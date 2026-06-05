import React from "react";
import {
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import { EmptyState } from "../components/EmptyState";
import { Section } from "../components/Section";

export function AdminPasskeysSection({
  passkeys = [],
  onRegister,
  onDelete,
  onToast
}) {
  const addPasskey = () => {
    onRegister?.().catch((error) => onToast?.(error.message, "error"));
  };

  return (
    <Section
      title="管理员 Passkey"
      icon={<FingerprintIcon />}
      action={
        <Button startIcon={<FingerprintIcon />} variant="contained" onClick={addPasskey}>
          绑定
        </Button>
      }
    >
      {passkeys.length ? (
        <Stack spacing={1}>
          {passkeys.map((passkey) => (
            <Stack
              key={passkey.id}
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "stretch", sm: "center" }}
              justifyContent="space-between"
              spacing={1.25}
              sx={{
                p: 1.25,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "background.paper"
              }}
            >
              <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap>
                  {passkey.name || "Admin Passkey"}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {passkey.preview || "credential"} · 最近使用 {passkey.lastUsedAt || "尚未使用"}
                </Typography>
              </Stack>
              <Tooltip title="删除 Passkey">
                <IconButton size="small" color="error" onClick={() => onDelete?.(passkey)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      ) : (
        <EmptyState text="尚未绑定管理员 Passkey。绑定后可在登录页免输密码进入管理后台。" />
      )}
    </Section>
  );
}
