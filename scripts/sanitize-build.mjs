import { readdir, rm } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
let entries = [];
try {
  entries = await readdir(dist, { withFileTypes: true });
} catch {
  entries = [];
}

await Promise.all(
  entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => rm(new URL(`${entry.name}/.dev.vars`, dist), { force: true })),
);
