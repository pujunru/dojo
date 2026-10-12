"use client";

import * as React from "react";
import type { DojoContentPointer } from "../core/content-schema";

const STORAGE_KEY = "dojo.series";

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function readQuery(): string | null {
  try {
    return new URL(window.location.href).searchParams.get("series");
  } catch {
    return null;
  }
}

/**
 * The series the dojo shows. Resolved from `?series=` (a shareable link),
 * then the last choice on this device, then the first series of the build.
 * A choice that the current build no longer ships falls back the same way.
 */
export function useSelectedSeries(pointer: DojoContentPointer | null): [string | null, (id: string) => void] {
  // `?series=` is read once, at mount: the workspace's hash routing may
  // rewrite the URL before the content pointer has loaded.
  const [chosen, setChosen] = React.useState<string | null>(() => (typeof window === "undefined" ? null : readQuery()));
  const available = pointer?.series.map((s) => s.id) ?? [];

  const resolved = React.useMemo(() => {
    if (!pointer) return null;
    const ids = pointer.series.map((s) => s.id);
    for (const candidate of [chosen, typeof window === "undefined" ? null : readStored()]) {
      if (candidate && ids.includes(candidate)) return candidate;
    }
    return ids[0] ?? null;
  }, [pointer, chosen]);

  const select = React.useCallback((id: string) => {
    if (!available.includes(id)) return;
    setChosen(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // The choice still applies to this visit.
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("series", id);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // No URL update outside a browser.
    }
  }, [available]);

  return [resolved, select];
}
