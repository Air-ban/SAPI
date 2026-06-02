import React, { useState } from "react";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Button
} from "@mui/material";

export function ConfirmDialog({ confirm, onClose, onError }) {
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!confirm) return;
    setLoading(true);
    try {
      await confirm.action();
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={Boolean(confirm)} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{confirm?.title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{confirm?.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          取消
        </Button>
        <Button
          variant="contained"
          color={confirm?.danger ? "error" : "primary"}
          onClick={run}
          disabled={loading}
        >
          {confirm?.confirmText || "确认"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
