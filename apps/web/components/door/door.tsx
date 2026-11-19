"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Lot } from "@/lib/yard/types";
import { pad2 } from "@/lib/format";

const DoorScene = dynamic(() => import("./door-scene"), { ssr: false });

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const f = () => setReduced(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return reduced;
}

interface Props {
  unit: number;
  paint?: string;
  clues: string[];
  found: boolean[];
  onFound?: (i: number) => void;
  open: boolean;
  contents?: Lot[] | null;
  attract?: boolean;
  className?: string;
  label?: string;
}

/** The 3D storage door. Renders only while on screen; a flat steel door stands in until WebGL is ready. */
export function Door({ className = "", label, ...p }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0, inside: false });
  const [seen, setSeen] = useState(false);
  const [active, setActive] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      setActive(e.isIntersecting);
      if (e.isIntersecting) setSeen(true);
    }, { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const move = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    pointer.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.current.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    pointer.current.inside = true;
  };

  return (
    <div
      ref={box}
      role="img"
      aria-label={label ?? `Storage unit ${pad2(p.unit)}, ${p.open ? "door open" : "door shut"}`}
      className={`overflow-hidden bg-[#07080a] ${className}`}
      onPointerMove={move}
      onPointerDown={move}
    >
      <div className="steel absolute inset-x-[18%] bottom-[14%] top-[12%] opacity-25" style={{ ["--door" as string]: p.paint ?? "#4d5560" }} aria-hidden />
      {seen && (
        <div className="absolute inset-0">
          <DoorScene {...p} active={active} reduced={reduced} pointer={pointer} />
        </div>
      )}
    </div>
  );
}
