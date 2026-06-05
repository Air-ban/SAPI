import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "client",
  build: {
    outDir: "../public",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("@mui/icons-material")) {
            return "vendor-mui-icons";
          }
          if (
            id.includes("react") ||
            id.includes("react-dom") ||
            id.includes("scheduler") ||
            id.includes("@mui/material") ||
            id.includes("@mui/system") ||
            id.includes("@mui/private-theming") ||
            id.includes("@emotion/")
          ) {
            return "vendor-ui";
          }
          if (
            id.includes("recharts") ||
            id.includes("victory-vendor") ||
            id.includes("d3-")
          ) {
            return "vendor-charts";
          }
          if (id.includes("highlight.js") || id.includes("marked")) {
            return "vendor-markdown";
          }
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/v1": "http://localhost:3000",
      "/responses": "http://localhost:3000"
    }
  }
});
