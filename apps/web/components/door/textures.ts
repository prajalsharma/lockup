"use client";
import * as THREE from "three";

function family(varName: string, fallback: string) {
  const v = getComputedStyle(document.body).getPropertyValue(varName).trim();
  return v || fallback;
}

export async function fontsReady() {
  const anton = family("--font-anton", "Impact");
  const mono = family("--font-plex-mono", "monospace");
  try {
    await Promise.all([document.fonts.load(`400 120px ${anton}`), document.fonts.load(`500 40px ${mono}`)]);
  } catch { /* fall back to system faces */ }
  return { anton, mono };
}

function tex(canvas: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Stencilled unit number sprayed on the door. */
export function numberTexture(n: number, anton: string) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 640;
  const g = c.getContext("2d")!;
  const label = String(n).padStart(2, "0");
  g.font = `400 560px ${anton}`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "rgba(239,234,224,0.9)";
  g.fillText(label, 512, 350);
  // Stencil bridges: thin gaps cut through the digits.
  g.globalCompositeOperation = "destination-out";
  for (let x = 150; x < 1024; x += 170) g.fillRect(x, 0, 16, 640);
  g.fillRect(0, 300, 1024, 14);
  // Worn paint.
  for (let i = 0; i < 2600; i++) {
    g.globalAlpha = Math.random() * 0.5;
    g.fillRect(Math.random() * 1024, Math.random() * 640, 1 + Math.random() * 5, 1 + Math.random() * 2);
  }
  return tex(c);
}

/** Paper tag wired to the door with one clue on it. */
export function tagTexture(text: string, index: number, mono: string) {
  const c = document.createElement("canvas");
  c.width = 768; c.height = 384;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d9c9a3";
  g.beginPath();
  g.moveTo(70, 0); g.lineTo(768, 0); g.lineTo(768, 384); g.lineTo(70, 384); g.lineTo(0, 300); g.lineTo(0, 84);
  g.closePath(); g.fill();
  g.fillStyle = "#14110a";
  g.beginPath(); g.arc(70, 192, 22, 0, Math.PI * 2); g.fill();
  g.font = `600 36px ${mono}`;
  g.textBaseline = "top";
  g.fillStyle = "#6b5a2a";
  g.fillText(`CLUE 0${index + 1}`, 130, 36);
  g.fillStyle = "#14110a";
  g.font = `600 66px ${mono}`;
  // Wrap to two or three lines.
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > 600 && line) { lines.push(line); line = w; } else line = next;
  }
  lines.push(line);
  lines.slice(0, 3).forEach((l, i) => g.fillText(l, 130, 98 + i * 84));
  return tex(c);
}

/** Label on a crate once the unit is open. */
export function crateTexture(name: string, qty: number, rarity: string, mono: string) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = rarity === "grail" ? "#ffb01f" : rarity === "rare" ? "#e8dcc0" : "#b39a6b";
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(20,17,10,0.55)"; g.lineWidth = 14;
  g.strokeRect(22, 22, 468, 468);
  g.fillStyle = "#14110a";
  g.font = `600 30px ${mono}`;
  g.textBaseline = "top";
  g.fillText(rarity.toUpperCase(), 54, 54);
  if (qty > 1) { g.textAlign = "right"; g.fillText(`×${qty}`, 458, 54); g.textAlign = "left"; }
  g.font = `600 56px ${mono}`;
  const words = name.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > 400 && line) { lines.push(line); line = w; } else line = next;
  }
  lines.push(line);
  lines.slice(0, 4).forEach((l, i) => g.fillText(l, 54, 190 + i * 70));
  return tex(c);
}
