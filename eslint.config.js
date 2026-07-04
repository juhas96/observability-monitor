import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const configCandidates = [
  resolve(__dirname, "../glaze-core/cli/lint/eslint.config.js"),
  resolve(__dirname, "../../../sdk/current/@glaze/core/cli/lint/eslint.config.js"),
];

const glazeConfigPath = configCandidates.find(existsSync);
if (!glazeConfigPath) {
  throw new Error(`[glaze] ESLint config not found. Searched: ${configCandidates.join(", ")}`);
}

const { default: glazeConfig } = await import(pathToFileURL(glazeConfigPath).href);

export default [
  { ignores: [".build/**"] },
  ...glazeConfig,
];
