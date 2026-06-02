import React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { CodeBlock } from "./CodeBlock";

export function CreatedKeyDialog({ info, onClose, onCopy }) {
  if (!info) return null;
  return (
    <Dialog open={Boolean(info)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>API Key 已创建</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Alert severity="success">
            Key 已创建并保存，可随时在列表中查看和复制。
          </Alert>
          <TextField
            label="API Key"
            value={info.key}
            fullWidth
            size="small"
            InputProps={{ readOnly: true }}
          />
          {info.allowedModels?.length > 0 ? (
            <Box>
              <Typography variant="caption" color="text.secondary">
                允许使用的模型：
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                {info.allowedModels.map((model) => (
                  <Chip key={model} label={model} size="small" variant="outlined" />
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button
          variant="contained"
          startIcon={<ContentCopyIcon />}
          onClick={() => onCopy(info.key)}
        >
          复制 Key
        </Button>
      </DialogActions>
    </Dialog>
  );
}
