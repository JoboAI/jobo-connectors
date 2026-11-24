#!/usr/bin/env node
/**
 * Regenerates Jobo.Connectors/contracts/signals.json from the built
 * connector-core: the committed artifact the connectors that cannot import
 * the core (Python, PHP, declarative JSON) check their Hiring Signals
 * surface against. Run after changing src/signals.ts:
 *
 *   npm run build --workspace @jobo-ai/connector-core
 *   node packages/connector-core/scripts/generate-signals-contract.mjs
 *
 * signals.contract.test.ts fails the build when the committed JSON drifts
 * from src/signals.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const contractPath = join(packageRoot, "..", "..", "contracts", "signals.json");

const core = await import(pathToFileURL(join(packageRoot, "dist", "index.mjs")).href);

export function buildContract(exports) {
  return {
    $comment:
      "GENERATED from packages/connector-core/src/signals.ts — do not edit. " +
      "Regenerate with packages/connector-core/scripts/generate-signals-contract.mjs.",
    enums: {
      signal_types: [...exports.SIGNAL_TYPES],
      seniority: [...exports.SIGNAL_SENIORITY],
      company_sizes: [...exports.COMPANY_SIZES],
    },
    type_labels: { ...exports.SIGNAL_TYPE_LABELS },
    limits: {
      default_limit: exports.SIGNAL_DEFAULT_LIMIT,
      max_limit: exports.SIGNAL_MAX_LIMIT,
      max_list_values: exports.SIGNAL_MAX_LIST_VALUES,
    },
    sort: {
      values: [...exports.SIGNAL_SORTS],
      default: exports.SIGNAL_DEFAULT_SORT,
      poll: exports.SIGNAL_POLL_SORT,
    },
    filters: exports.HIRING_SIGNAL_FILTERS.map((filter) => ({
      key: filter.key,
      kind: filter.kind,
      ...(filter.options ? { options: [...filter.options] } : {}),
      ...(filter.narrowing ? { narrowing: true } : {}),
      ...(filter.company ? { company: true } : {}),
      ...(filter.min !== undefined ? { min: filter.min } : {}),
      ...(filter.max !== undefined ? { max: filter.max } : {}),
    })),
    company_filter_keys: [...exports.COMPANY_SIGNAL_FILTER_KEYS],
  };
}

mkdirSync(dirname(contractPath), { recursive: true });
writeFileSync(contractPath, JSON.stringify(buildContract(core), null, 2) + "\n");
console.log(`wrote ${contractPath}`);
