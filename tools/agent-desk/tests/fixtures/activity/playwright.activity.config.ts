import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import baseConfig from "../../../playwright.config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../../..");

export default {
  ...baseConfig,
  testDir: join(rootDir, "tests"),
  testMatch: [
    ...(Array.isArray(baseConfig.testMatch)
      ? baseConfig.testMatch
      : [baseConfig.testMatch]),
    "activity-browser.spec.ts",
  ],
  webServer: {
    ...baseConfig.webServer,
    cwd: rootDir,
  },
};
