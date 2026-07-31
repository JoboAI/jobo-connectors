import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  JOB_FEED_FILTER_KEYS,
  JOB_SEARCH_FILTERS,
  WORK_MODELS,
} from "./filters";

/**
 * Drift guard for Jobo.Connectors/contracts/filters.json — the committed
 * artifact the non-TypeScript consumers (WordPress PHP tests, n8n bundle
 * verifier, MCP tests) validate themselves against. If this fails, rebuild
 * and regenerate:
 *
 *   npm run build --workspace @jobo-ai/connector-core
 *   node packages/connector-core/scripts/generate-filters-contract.mjs
 */
describe("filters contract artifact", () => {
  it("matches src/filters.ts exactly", () => {
    const committed = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "contracts", "filters.json"), "utf8"),
    );

    // Same shape generate-filters-contract.mjs emits, built from src instead
    // of dist so the test needs no prior build.
    const expected = {
      enums: {
        work_models: [...WORK_MODELS],
        employment_types: [...EMPLOYMENT_TYPES],
        experience_levels: [...EXPERIENCE_LEVELS],
      },
      search_filters: JOB_SEARCH_FILTERS.map((filter) => ({
        key: filter.key,
        kind: filter.kind,
        ...(filter.options ? { options: [...filter.options] } : {}),
        ...(filter.narrowing ? { narrowing: true } : {}),
        ...(filter.dynamicOptions ? { dynamicOptions: filter.dynamicOptions } : {}),
      })),
      feed_filter_keys: [...JOB_FEED_FILTER_KEYS],
    };

    const { $comment: _ignored, ...withoutComment } = committed;
    expect(withoutComment).toEqual(expected);
  });
});
