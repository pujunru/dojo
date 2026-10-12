"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Content prose (prompts, explanations, model answers) is authored as
 * Markdown: code fences, inline code and short lists are part of the
 * specification. `skipHtml` keeps raw HTML inert.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  if (!children.trim()) return null;
  return (
    <div className={["dj-markdown", className].filter(Boolean).join(" ")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * The card shows a short excerpt, so Markdown syntax is stripped rather than
 * rendered: a fence marker or a `##` in a two-line preview is noise.
 */
export function markdownPreview(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*([-*]|\d+[.)])\s+/gm, "")
    .replace(/[`*|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
