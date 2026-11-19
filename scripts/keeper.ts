/** Run the keeper locally in a loop. The hosted site runs the same `tick()` from its API. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadKeeper, tick } from "../apps/web/lib/chain/keeper";

const k = loadKeeper(readFileSync(`${homedir()}/.lockup-keys/keeper.json`, "utf8"))!;
const rounds = Number(process.argv[2] ?? 1e9);
console.log("keeper", k.keeper.publicKey.toBase58(), "house", k.house.map((h) => h.publicKey.toBase58()).join(" "));
async function main() {
for (let i = 0; i < rounds; i++) {
  const r = await tick(k);
  if (r.did.length || r.errors.length) console.log(new Date().toISOString().slice(11, 19), r.did.join(" | "), r.errors.length ? `\n   ERR ${r.errors.join("\n   ERR ")}` : "");
  await new Promise((res) => setTimeout(res, 3000));
}
}
main();
