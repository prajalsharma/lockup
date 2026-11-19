import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Lockup: bid blind, open the door";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const anton = await readFile(join(process.cwd(), "assets/Anton-Regular.ttf"));
  const slats = Array.from({ length: 21 });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0a0b0e", color: "#efeae0", fontFamily: "Anton" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 0 56px 64px", width: 690 }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 40, letterSpacing: 0 }}>
            <div style={{ width: 22, height: 22, background: "#ffb01f", marginRight: 14 }} />
            LOCKUP
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 150, lineHeight: 0.95, textTransform: "uppercase" }}>
            <span>Bid blind.</span>
            <span>Open the</span>
            <span style={{ color: "#ffb01f" }}>door.</span>
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#a9a498", letterSpacing: 2 }}>SEALED-BID STORAGE UNITS ON SOLANA</div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "flex-end", justifyContent: "center", background: "#07080a", borderLeft: "1px solid #24272c" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 360, height: 520, background: "#4d5560", position: "relative" }}>
            {slats.map((_, i) => (
              <div key={i} style={{ height: 24.76, borderBottom: "5px solid rgba(0,0,0,0.28)", borderTop: "3px solid rgba(255,255,255,0.09)" }} />
            ))}
            <div style={{ position: "absolute", top: 110, left: 0, width: 360, display: "flex", justifyContent: "center", fontSize: 250, color: "rgba(239,234,224,0.88)" }}>07</div>
            <div style={{ position: "absolute", bottom: 22, left: 162, width: 36, height: 30, background: "#c9973a", borderRadius: 3 }} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14, display: "flex", backgroundImage: "repeating-linear-gradient(-45deg, #ffb01f 0 18px, #14110a 18px 36px)" }} />
      </div>
    ),
    { ...size, fonts: [{ name: "Anton", data: anton, style: "normal", weight: 400 }] },
  );
}
