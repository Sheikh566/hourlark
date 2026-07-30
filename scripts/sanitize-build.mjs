import { rm } from "node:fs/promises";

const localVariablesArtifact = new URL("../dist/iomechs_time/.dev.vars", import.meta.url);
await rm(localVariablesArtifact, { force: true });
