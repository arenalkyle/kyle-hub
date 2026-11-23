// Renders the brain shape point cloud to front/side/top PNGs: node scripts/brain-snapshot.mjs [outDir]
import { build } from "esbuild";
import { deflateSync } from "node:zlib";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(root, "snapshots"));
mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "brain-snap-"));
const load = async (src, name) => {
  const outfile = join(tmp, name);
  await build({ entryPoints: [join(root, src)], bundle: true, format: "esm", outfile, logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
};
const shape = await load("src/core/domain/brainShape.ts", "shape.mjs");
const { buildGraph, withFolders } = await load("src/core/domain/brainGraph.ts", "graph.mjs");

// Synthetic vault: 8 folders of different sizes plus root notes, links mostly inside a folder.
const folders = [["Projects", 900], ["Brain", 700], ["Daily", 600], ["People", 350], ["Retros", 300], ["Logs", 250], ["Ideas", 200], ["Reading", 150]];
let seed = 5;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const notes = [];
const byFolder = new Map();
for (const [f, c] of folders) {
  const list = [];
  for (let i = 0; i < (process.env.EQUAL ? 450 : c) * Number(process.env.SCALE ?? 1); i++) list.push(`${f}/n${i}.md`);
  byFolder.set(f, list);
  notes.push(...list);
}
for (let i = 0; i < 200; i++) notes.push(`root${i}.md`);
const links = {};
for (const p of notes) {
  const f = p.includes("/") ? p.split("/")[0] : null;
  const pool = f ? byFolder.get(f) : notes;
  links[p] = {};
  for (let k = 0; k < 2; k++) links[p][rnd() < 0.85 ? pool[Math.floor(rnd() * pool.length)] : notes[Math.floor(rnd() * notes.length)]] = 1;
}
const graph = withFolders(buildGraph(notes, links));
const cache = shape.newShapeCache();
const pos = shape.shapeTargets("brain", graph, cache);
const ids = shape.regionOf(graph, cache);
const regionIds = [...new Set(ids)];
const palette = [[255, 99, 99], [255, 180, 60], [240, 230, 80], [110, 230, 110], [70, 220, 220], [90, 140, 255], [190, 110, 255], [255, 110, 200], [200, 200, 200], [255, 255, 255]];
const colour = (i) => palette[regionIds.indexOf(ids[i]) % palette.length];

function png(w, h, rgb) {
  const crcT = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = ~0;
    for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
    return ~c >>> 0;
  };
  const chunk = (t, d) => {
    const b = Buffer.alloc(12 + d.length);
    b.writeUInt32BE(d.length, 0);
    b.write(t, 4);
    d.copy(b, 8);
    b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length);
    return b;
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const W = 900;
const H = 700;
function render(name, project) {
  const n = ids.length;
  const order = Array.from({ length: n }, (_, i) => i);
  const proj = order.map((i) => project(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  let maxR = 1;
  for (const p of proj) maxR = Math.max(maxR, Math.abs(p[0]), Math.abs(p[1]));
  const sc = (Math.min(W, H) * 0.46) / maxR;
  // Opaque look: only the half of the cloud facing the camera.
  const depths = proj.map((p) => p[2]).sort((a, b) => a - b);
  const mid = depths[Math.floor(depths.length * 0.45)];
  order.splice(0, order.length, ...order.filter((i) => proj[i][2] >= mid));
  order.sort((a, b) => proj[a][2] - proj[b][2]);
  const img = new Uint8Array(W * H * 3).fill(14);
  let dmin = Infinity;
  let dmax = -Infinity;
  for (const p of proj) {
    dmin = Math.min(dmin, p[2]);
    dmax = Math.max(dmax, p[2]);
  }
  for (const i of order) {
    const [sx, sy, d] = proj[i];
    const px = Math.round(W / 2 + sx * sc);
    const py = Math.round(H / 2 - sy * sc);
    const shade = 0.35 + 0.65 * ((d - dmin) / (dmax - dmin || 1));
    const c = colour(i);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = (y * W + x) * 3;
        for (let k = 0; k < 3; k++) img[o + k] = Math.round(c[k] * shade);
      }
  }
  const file = join(outDir, `brain-${name}${process.env.EQUAL ? "-equal" : ""}.png`);
  writeFileSync(file, png(W, H, img));
  console.log(file);
}
// +x right, +y up, +z front; the third component is depth toward the camera.
render("front", (x, y, z) => [x, y, z]);
render("side", (x, y, z) => [-z, y, x]); // front of the brain on the left
render("top", (x, y, z) => [x, z, y]); // front of the brain at the top
console.log(`nodes ${ids.length} regions ${regionIds.join(",")}`);
