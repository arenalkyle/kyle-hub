import { execFile } from "node:child_process";
import fs from "node:fs";
import type { FsPort, GitPort } from "./launch";

export const realGit: GitPort = {
  run: (args, cwd) =>
    new Promise((resolve, reject) => {
      execFile("git", args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
        err ? reject(new Error((stderr || err.message).toString().trim())) : resolve(stdout.toString()),
      );
    }),
};

export const realFs: FsPort = {
  exists: (p) => fs.existsSync(p),
  mkdirp: (p) => void fs.mkdirSync(p, { recursive: true }),
  writeFile: (p, text) => fs.writeFileSync(p, text, "utf8"),
};
