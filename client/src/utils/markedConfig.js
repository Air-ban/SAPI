import { marked } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("text", plaintext);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);

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
