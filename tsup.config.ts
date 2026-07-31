import { defineConfig } from "tsup";

// connector-core has no runtime dependencies by design: n8n's verified-node
// scanner rejects a non-empty `dependencies`, Make has no JS runtime at all,
// and Apps Script has no npm. Consumers add this package as a devDependency
// and inline it via `noExternal`, so nothing here may reach for a bundle-time
// external.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
});
