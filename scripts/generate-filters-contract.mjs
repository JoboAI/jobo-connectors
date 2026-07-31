#!/usr/bin/env node
/**
 * Regenerates Jobo.Connectors/contracts/filters.json from the built
 * connector-core — the committed artifact non-TypeScript consumers (the
 * WordPress PHP test harness, the n8n bundle verifier, the MCP tests) check
 * themselves against. Run after changing src/filters.ts:
 *
 *   npm run build --workspace @jobo-ai/connector-core
 *   node packages/connector-core/scripts/generate-filters-contract.mjs
 *
 * filters.contract.test.ts fails the build when the committed JSON drifts
 * from src/filters.ts, mirroring the generate-job-field-catalogue pattern
 * in Jobo.Enterprise.Web.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const contractPath = join(packageRoot, "..", "..", "contracts", "filters.json");

const core = await import(join(packageRoot, "dist", "index.mjs"));

export function buildContract(exports) {
  return {
    $comment:
      "GENERATED from packages/connector-core/src/filters.ts — do not edit. " +
      "Regenerate with packages/connector-core/scripts/generate-filters-contract.mjs.",
    enums: {
      work_models: [...exports.WORK_MODELS],
      employment_types: [...exports.EMPLOYMENT_TYPES],
      experience_levels: [...exports.EXPERIENCE_LEVELS],
    },
    search_filters: exports.JOB_SEARCH_FILTERS.map((filter) => ({
      key: filter.key,
      kind: filter.kind,
      ...(filter.options ? { options: [...filter.options] } : {}),
      ...(filter.narrowing ? { narrowing: true } : {}),
      ...(filter.dynamicOptions ? { dynamicOptions: filter.dynamicOptions } : {}),
    })),
    feed_filter_keys: [...exports.JOB_FEED_FILTER_KEYS],
  };
}

mkdirSync(dirname(contractPath), { recursive: true });
writeFileSync(contractPath, JSON.stringify(buildContract(core), null, 2) + "\n");
console.log(`wrote ${contractPath}`);
