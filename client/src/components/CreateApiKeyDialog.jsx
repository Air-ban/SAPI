import React, { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  TextField
} from "@mui/material";
import { modelDisplayParts } from "../utils/helpers";

export function CreateApiKeyDialog({ open, models, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    if (loading) return;
    setName("");
    setSelectedModels([]);
    onClose();
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      await onCreate({
        name: name.trim(),
        allowedModels: selectedModels
      });
      setName("");
      setSelectedModels([]);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const modelOptions = models.map((item) => {
    const parts = modelDisplayParts(item);
    return { id: parts.id, label: parts.displayName, secondary: parts.secondary };
  });

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>新增 API Key</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="名称"
            placeholder="例如：开发测试 Key"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
          />
          <FormControl fullWidth size="small">
            <InputLabel id="models-select-label">允许使用的模型（可选）</InputLabel>
            <Select
              labelId="models-select-label"
              multiple
              value={selectedModels}
              onChange={(e) => setSelectedModels(e.target.value)}
              input={<OutlinedInput label="允许使用的模型（可选）" />}
              renderValue={(selected) => (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {selected.map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {modelOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  <Checkbox checked={selectedModels.includes(option.id)} />
                  <ListItemText primary={option.label} secondary={option.secondary || null} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <DialogContentText sx={{ fontSize: 13 }}>
            不选择任何模型则允许使用全部模型。
          </DialogContentText>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          取消
        </Button>
        <Button variant="contained" onClick={handleCreate} disabled={loading}>
          创建
        </Button>
      </DialogActions>
    </Dialog>
  );
}
