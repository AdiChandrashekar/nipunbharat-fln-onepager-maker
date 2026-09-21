import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  hint?: string; // keyboard shortcut shown on the right
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}
export type MenuEntry = MenuItem | "sep";

/** Right-click menu at the pointer; closes on click-away, Escape, scroll or resize. Keeps itself on screen. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.min(x, innerWidth - r.width - 8), top: Math.min(y, innerHeight - r.height - 8) });
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", onClose);
    document.querySelector(".canvas")?.addEventListener("scroll", onClose);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", onClose);
      document.querySelector(".canvas")?.removeEventListener("scroll", onClose);
    };
  }, [onClose]);

  // Drop leading/trailing/double separators left behind by conditional items.
  const clean = items.filter((it, i, all) => it !== "sep" || (i > 0 && i < all.length - 1 && all[i - 1] !== "sep"));

  return (
    <div ref={ref} className="ctx-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {clean.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <button key={i} role="menuitem" disabled={it.disabled} className={it.danger ? "danger" : ""}
            onClick={() => { onClose(); it.onClick(); }}>
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
