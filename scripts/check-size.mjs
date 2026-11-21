import fs from "node:fs";

const LIMIT = 3 * 1024 * 1024;
const file = process.argv[2] ?? "main.js";
const size = fs.statSync(file).size;
console.log(`${file}: ${(size / 1024).toFixed(0)} KB (limit ${LIMIT / 1024} KB)`);
if (size > LIMIT) { console.error("bundle size budget exceeded"); process.exit(1); }
