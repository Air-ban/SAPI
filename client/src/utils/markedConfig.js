import { marked } from "marked";
import hljs from "highlight.js";

export function setupMarked() {
  marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: true,
    mangle: false,
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch {
          return code;
        }
      }
      return code;
    }
  });
}
