export const DRAWER_WIDTH = 276;
export const ADMIN_TOKEN_KEY = "sapiAdminToken";
export const USER_TOKEN_KEY = "sapiUserToken";

export const CLI_TOOLS = [
  { id: "codex", name: "Codex" },
  { id: "claude-code", name: "Claude Code" },
  { id: "openclaw", name: "OpenClaw" },
  { id: "cursor", name: "Cursor" },
  { id: "aider", name: "Aider" },
  { id: "copilot", name: "GitHub Copilot" },
  { id: "cline", name: "Cline" },
  { id: "windsurf", name: "Windsurf" },
  { id: "continue", name: "Continue" }
];

export const CODE_AGENT_USER_AGENTS = [
  {
    id: "claude-code",
    name: "Claude Code",
    value: "Claude-User (claude-code/2.1.87; +https://support.anthropic.com/)"
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    value: "Codex-User (codex-cli; +https://openai.com/codex)"
  },
  {
    id: "cursor",
    name: "Cursor",
    value: "Cursor-User (cursor; +https://cursor.com/)"
  },
  {
    id: "aider",
    name: "Aider",
    value: "Aider-User (aider; +https://aider.chat/)"
  },
  {
    id: "cline",
    name: "Cline",
    value: "Cline-User (cline; +https://cline.bot/)"
  },
  {
    id: "windsurf",
    name: "Windsurf",
    value: "Windsurf-User (windsurf; +https://windsurf.com/)"
  },
  {
    id: "continue",
    name: "Continue",
    value: "Continue-User (continue; +https://continue.dev/)"
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    value: "GitHubCopilot-User (github-copilot; +https://github.com/features/copilot)"
  }
];
