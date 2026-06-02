import React, { useState } from "react";
import {
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FeedbackIcon from "@mui/icons-material/Feedback";
import { Section } from "../components/Section";
import { EmptyState } from "../components/EmptyState";
import { request } from "../utils/api";

export function AdminSuggestionsSection({ suggestions, afterChange, onConfirm, onToast }) {
  const [loadingId, setLoadingId] = useState("");

  const remove = async (id) => {
    setLoadingId(id);
    try {
      await request(`/api/admin/suggestions/${id}`, { method: "DELETE" });
      await afterChange("建议已删除");
    } catch (error) {
      onToast(error.message, "error");
    } finally {
      setLoadingId("");
    }
  };

  return (
    <Section title="用户建议列表" icon={<FeedbackIcon />}>
      {suggestions.length ? (
        <Stack spacing={1.5}>
          {suggestions.map((item) => (
            <Paper
              key={item.id}
              variant="outlined"
              sx={{ p: 2, bgcolor: "#fbfcfe" }}
            >
              <Stack spacing={1}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                  flexWrap="wrap"
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 780 }}>
                    {item.title}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : ""}
                    </Typography>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      disabled={loadingId === item.id}
                      onClick={() =>
                        onConfirm({
                          title: "删除建议",
                          message: `确认删除这条建议？`,
                          confirmText: "删除",
                          danger: true,
                          action: () => remove(item.id)
                        })
                      }
                    >
                      {loadingId === item.id ? (
                        <CircularProgress size={16} />
                      ) : (
                        <DeleteOutlineIcon fontSize="small" />
                      )}
                    </Button>
                  </Stack>
                </Stack>
                {item.userName ? (
                  <Typography variant="body2" color="text.secondary">
                    提交用户：{item.userName}
                  </Typography>
                ) : null}
                {item.contact ? (
                  <Typography variant="body2" color="text.secondary">
                    联系方式：{item.contact}
                  </Typography>
                ) : null}
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: "pre-wrap",
                    bgcolor: "background.default",
                    p: 1.5,
                    borderRadius: 1
                  }}
                >
                  {item.content}
                </Typography>
              </Stack>
            </Paper>
          ))}
        </Stack>
      ) : (
        <EmptyState text="还没有收到用户建议。" />
      )}
    </Section>
  );
}
