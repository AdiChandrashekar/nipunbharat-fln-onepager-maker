import { useEffect, useState } from "react";

const KEY = "onepager-maker:ui:";

/**
 * A UI preference (panel widths, collapsed bars) remembered in this browser. Storage can be missing or
 * blocked (private windows); the preference then just lasts for the session.
 */
export function usePref<T>(name: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const s = localStorage.getItem(KEY + name);
      return s === null ? initial : (JSON.parse(s) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY + name, JSON.stringify(value));
    } catch { /* not remembered */ }
  }, [name, value]);
  return [value, setValue];
}
