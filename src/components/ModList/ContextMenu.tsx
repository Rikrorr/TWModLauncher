import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export default function ContextMenu({ x, y, onClose, children }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustX, setAdjustX] = useState(false);
  const [adjustY, setAdjustY] = useState(false);

  // Measure menu after mount and flip if it overflows viewport
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) setAdjustX(true);
    if (rect.bottom > window.innerHeight) setAdjustY(true);
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid the same right-click event that opened it from closing it
    const id = setTimeout(() => document.addEventListener("click", handleClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handleClick);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Close on scroll
  useEffect(() => {
    const handleScroll = () => onClose();
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [onClose]);

  // Close on context menu (right-click elsewhere)
  useEffect(() => {
    const handleCtx = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid the same event that opened the menu from closing it
    const id = setTimeout(() => document.addEventListener("contextmenu", handleCtx), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("contextmenu", handleCtx);
    };
  }, [onClose]);

  const left = adjustX ? x - 0 : x;
  const top = adjustY ? y - 0 : y;
  const transform = `${adjustX ? "translateX(-100%)" : ""} ${adjustY ? "translateY(-100%)" : ""}`.trim();

  return createPortal(
    <div
      ref={menuRef}
      className="fixed bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[160px] z-[9999]"
      style={{
        left,
        top,
        transform: transform || undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
