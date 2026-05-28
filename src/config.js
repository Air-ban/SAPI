require("dotenv").config();

const PORT = Number(process.env.SAPI_PORT || process.env.PORT || 3000);
const ADMIN_USER = process.env.SAPI_ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.SAPI_ADMIN_PASSWORD || "sapi-admin";
const PUBLIC_BASE_URL = process.env.SAPI_PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const TENCENT_CAPTCHA_APP_ID = process.env.SAPI_TENCENT_CAPTCHA_APP_ID || "";
const TENCENT_CAPTCHA_APP_SECRET_KEY = process.env.SAPI_TENCENT_CAPTCHA_APP_SECRET_KEY || "";
const TENCENT_SECRET_ID = process.env.SAPI_TENCENT_SECRET_ID || "";
const TENCENT_SECRET_KEY = process.env.SAPI_TENCENT_SECRET_KEY || "";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length"
]);

const C_RESET = "\x1b[0m";
const C_GREEN = "\x1b[32m";
const C_RED = "\x1b[31m";
const C_YELLOW = "\x1b[33m";
const C_CYAN = "\x1b[36m";
const C_DIM = "\x1b[2m";
const C_BOLD = "\x1b[1m";

const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "SAPI Proxy API",
    description: "SAPI OpenAI-compatible proxy endpoints. Use your SAPI API Key in the Authorization header: Bearer sk-sapi-...",
    version: "0.1.0"
  },
  servers: [{ url: PUBLIC_BASE_URL }],
  tags: [
    { name: "Models", description: "List available models" },
    { name: "Chat", description: "Chat completions" },
    { name: "Completions", description: "Text completions" },
    { name: "Embeddings", description: "Text embeddings" },
    { name: "Anthropic", description: "Anthropic-compatible endpoints" }
  ],
  paths: {
    "/v1/models": {
      get: {
        tags: ["Models"],
        summary: "List available models",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Models list" }
        }
      }
    },
    "/v1/chat/completions": {
      post: {
        tags: ["Chat"],
        summary: "Chat completions",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string", example: "gpt-4o-mini" },
                  messages: { type: "array", items: { type: "object" }, example: [{ role: "user", content: "hello" }] },
                  stream: { type: "boolean", example: false },
                  temperature: { type: "number", example: 0.7 },
                  max_tokens: { type: "integer", example: 2048 }
                },
                required: ["model", "messages"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Chat completion response" }
        }
      }
    },
    "/v1/completions": {
      post: {
        tags: ["Completions"],
        summary: "Text completions",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  prompt: { type: "string" },
                  stream: { type: "boolean" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Completion response" }
        }
      }
    },
    "/v1/embeddings": {
      post: {
        tags: ["Embeddings"],
        summary: "Create embeddings",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  input: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Embeddings response" }
        }
      }
    },
    "/v1/messages": {
      post: {
        tags: ["Anthropic"],
        summary: "Anthropic Messages API",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  messages: { type: "array", items: { type: "object" } },
                  max_tokens: { type: "integer" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Message response" }
        }
      }
    },
    "/v1/messages/count_tokens": {
      post: {
        tags: ["Anthropic"],
        summary: "Count tokens (Anthropic)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  messages: { type: "array", items: { type: "object" } }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Token count response" }
        }
      }
    },
    "/responses": {
      post: {
        tags: ["Chat"],
        summary: "OpenAI Responses API",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  input: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Response" }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    }
  }
};

module.exports = {
  PORT,
  ADMIN_USER,
  ADMIN_PASSWORD,
  PUBLIC_BASE_URL,
  TENCENT_CAPTCHA_APP_ID,
  TENCENT_CAPTCHA_APP_SECRET_KEY,
  TENCENT_SECRET_ID,
  TENCENT_SECRET_KEY,
  HOP_BY_HOP_HEADERS,
  C_RESET,
  C_GREEN,
  C_RED,
  C_YELLOW,
  C_CYAN,
  C_DIM,
  C_BOLD,
  swaggerSpec
};
