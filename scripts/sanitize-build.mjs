import { rm } from "node:fs/promises";

const localVariablesArtifact = new URL("../dist/hourlark/.dev.vars", import.meta.url);
await rm(localVariablesArtifact, { force: true });
