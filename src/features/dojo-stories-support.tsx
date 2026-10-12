"use client";

/**
 * Story-only framing for the Dojo stories. Not exported from the
 * feature index and never rendered by product code.
 */
import * as React from "react";
import { useLocale } from "use-intl";

export function useIsZh() {
  return useLocale() === "zh-CN";
}

/** Canvas padding + a max reading width, like the workspace content track. */
export function DojoStage({ children, width = "52rem", gap = "var(--space-5)" }: { children: React.ReactNode; width?: string; gap?: string }) {
  return (
    <div data-workspace-root style={{ minHeight: "100dvh", padding: "var(--page-gutter)", background: "var(--background)" }}>
      <div style={{ display: "grid", gap, width: `min(100%, ${width})`, marginInline: "auto" }}>{children}</div>
    </div>
  );
}

/** Small caption above a state in a matrix story. */
export function StateLabel({ children }: { children: React.ReactNode }) {
  return <p className="dj-type-caption" style={{ margin: 0, color: "var(--muted-foreground)", fontFamily: "var(--font-data)" }}>{children}</p>;
}
