import { useCallback, useRef, useState } from "react";

const LIMIT = 200;

/**
 * Undo/redo over whole document snapshots. Documents are small (a few hundred elements), and edits
 * replace objects immutably, so snapshots share structure and stay cheap.
 * - commit: a user action; pushes the previous state onto the undo stack.
 * - replace: derived updates (auto-layout results); rewrites the present without a new undo step.
 * State lives in a ref (not a setState updater) so StrictMode's double-invoked updaters can't double-push.
 */
export function useHistory<T>(initial: () => T) {
  const state = useRef<T | null>(null);
  if (state.current === null) state.current = initial();
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const [, render] = useState(0);
  const rerender = () => render((n) => n + 1);

  const lastMerge = useRef<{ key: string; at: number } | null>(null);

  /** mergeKey: consecutive commits with the same key within 1.2 s (e.g. typing a title) form one undo step. */
  const commit = useCallback((fn: (d: T) => T, mergeKey?: string) => {
    const cur = state.current as T;
    const next = fn(cur);
    if (next === cur) return;
    const now = Date.now();
    const merge = mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < 1200;
    lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
    if (!merge) {
      past.current.push(cur);
      if (past.current.length > LIMIT) past.current.shift();
    }
    future.current = [];
    state.current = next;
    rerender();
  }, []);

  const replace = useCallback((fn: (d: T) => T) => {
    state.current = fn(state.current as T);
    rerender();
  }, []);

  const reset = useCallback((d: T) => {
    past.current = [];
    future.current = [];
    state.current = d;
    rerender();
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(state.current as T);
    state.current = prev;
    rerender();
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(state.current as T);
    state.current = next;
    rerender();
  }, []);

  return {
    doc: state.current as T,
    /** Latest state, for event handlers that run between renders. */
    get: () => state.current as T,
    commit, replace, reset, undo, redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
