import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPANY_SIZES } from "./filters";
import { SIGNAL_TYPE_LABELS } from "./signal-summary";
import {
  COMPANY_SIGNAL_FILTER_KEYS,
  HIRING_SIGNAL_FILTERS,
  SIGNAL_DEFAULT_LIMIT,
  SIGNAL_DEFAULT_SORT,
  SIGNAL_MAX_LIMIT,
  SIGNAL_MAX_LIST_VALUES,
  SIGNAL_POLL_SORT,
  SIGNAL_SENIORITY,
  SIGNAL_SORTS,
  SIGNAL_TYPES,
} from "./signals";

const repoRoot = join(__dirname, "..", "..", "..", "..");

/**
 * Drift guard for Jobo.Connectors/contracts/signals.json, the committed
 * artifact the connectors that cannot import this package check their Hiring
 * Signals surface against. If this fails, rebuild and regenerate:
 *
 *   npm run build --workspace @jobo-ai/connector-core
 *   node packages/connector-core/scripts/generate-signals-contract.mjs
 */
describe("signals contract artifact", () => {
  it("matches src/signals.ts exactly", () => {
    const committed = JSON.parse(readFileSync(join(repoRoot, "Jobo.Connectors", "contracts", "signals.json"), "utf8"));

    // Same shape generate-signals-contract.mjs emits, built from src instead
    // of dist so the test needs no prior build.
    const expected = {
      enums: {
        signal_types: [...SIGNAL_TYPES],
        seniority: [...SIGNAL_SENIORITY],
        company_sizes: [...COMPANY_SIZES],
      },
      type_labels: { ...SIGNAL_TYPE_LABELS },
      limits: {
        default_limit: SIGNAL_DEFAULT_LIMIT,
        max_limit: SIGNAL_MAX_LIMIT,
        max_list_values: SIGNAL_MAX_LIST_VALUES,
      },
      sort: {
        values: [...SIGNAL_SORTS],
        default: SIGNAL_DEFAULT_SORT,
        poll: SIGNAL_POLL_SORT,
      },
      filters: HIRING_SIGNAL_FILTERS.map((filter) => ({
        key: filter.key,
        kind: filter.kind,
        ...(filter.options ? { options: [...filter.options] } : {}),
        ...(filter.narrowing ? { narrowing: true } : {}),
        ...(filter.company ? { company: true } : {}),
        ...(filter.min !== undefined ? { min: filter.min } : {}),
        ...(filter.max !== undefined ? { max: filter.max } : {}),
      })),
      company_filter_keys: [...COMPANY_SIGNAL_FILTER_KEYS],
    };

    const { $comment: _ignored, ...withoutComment } = committed;
    expect(withoutComment).toEqual(expected);
  });
});

/**
 * The API itself, read from its source. These run in the monorepo and are
 * skipped in the public mirror of this package, where the API's source is not
 * checked out.
 */
describe("signals surface against the API's source", () => {
  const api = join(repoRoot, "Jobo.Enterprise");
  const controller = join(api, "Web", "Jobo.Enterprise.External.Api", "Controllers", "HiringSignalsController.cs");
  const types = join(api, "Modules", "Jobo.Enterprise.Module.HiringSignals", "Models", "HiringSignalTypes.cs");
  const focus = join(api, "Modules", "Jobo.Enterprise.Module.HiringSignals", "Models", "HiringSignalFocus.cs");
  const query = join(api, "Modules", "Jobo.Enterprise.Module.HiringSignals", "Models", "HiringSignalQuery.cs");
  const sorts = join(api, "Modules", "Jobo.Enterprise.Module.HiringSignals", "Models", "HiringSignalSort.cs");
  const present = [controller, types, focus, query].every((path) => existsSync(path));

  /**
   * Query parameters that say how to read, not what to match: they are paging
   * options here, not filters. `sort` is one from the API change that added
   * the stored order; a checkout from before it has no `sort` to list, and
   * the filter tests below have to hold on both.
   */
  const PAGING = ["limit", "cursor", "sort"];

  /** `[FromQuery(Name = "…")]` names inside one action, in order. */
  function queryNames(source: string, action: string): string[] {
    const start = source.indexOf(`> ${action}(`);
    const end = source.indexOf("CancellationToken cancellationToken", start);
    return [...source.slice(start, end).matchAll(/\[FromQuery\(Name = "(\w+)"\)\]/g)].map((match) => match[1]!);
  }

  it.skipIf(!present)("has a filter for every query parameter of GET /api/signals, and no other", () => {
    const names = queryNames(readFileSync(controller, "utf8"), "List");
    const filters = names.filter((name) => !PAGING.includes(name));

    expect(names).toContain("limit");
    expect(names).toContain("cursor");
    expect([...HIRING_SIGNAL_FILTERS.map((filter) => filter.key)].sort()).toEqual([...filters].sort());
  });

  it.skipIf(!present)("marks exactly the filters the per-company endpoint takes", () => {
    const names = queryNames(readFileSync(controller, "utf8"), "ListForCompany");
    const filters = names.filter((name) => !PAGING.includes(name));

    expect([...COMPANY_SIGNAL_FILTER_KEYS].sort()).toEqual([...filters].sort());
  });

  // Runs once the API's source has the stored order (HiringSignalSort.cs).
  it.skipIf(!existsSync(sorts))("lists the API's sort values, the default first, and polls in the stored order", () => {
    const source = readFileSync(sorts, "utf8");
    const constants = new Map(
      [...source.matchAll(/public const string (\w+) = "(\w+)";/g)].map((match) => [match[1]!, match[2]!]),
    );
    const all = /All =\s*\[([^\]]+)\]/.exec(source)?.[1] ?? "";
    const ordered = all
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => constants.get(name));

    expect(ordered).toEqual([...SIGNAL_SORTS]);
    expect(SIGNAL_SORTS[0]).toBe(SIGNAL_DEFAULT_SORT);
    expect(constants.get("CreatedAsc")).toBe(SIGNAL_POLL_SORT);
    for (const action of ["List", "ListForCompany"]) {
      expect(queryNames(readFileSync(controller, "utf8"), action)).toContain("sort");
    }
  });

  it.skipIf(!present)("lists the API's signal types, in its order", () => {
    const source = readFileSync(types, "utf8");
    const constants = new Map(
      [...source.matchAll(/public const string (\w+) = "(\w+)";/g)].map((match) => [match[1]!, match[2]!]),
    );
    const all = /All \{ get; \} =\s*\[([^\]]+)\]/.exec(source)?.[1] ?? "";
    const ordered = all
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => constants.get(name));

    expect(ordered).toEqual([...SIGNAL_TYPES]);
  });

  it.skipIf(!present)("lists the API's seniority levels, lowest first", () => {
    const source = readFileSync(focus, "utf8");
    const section = source.slice(source.indexOf("class HiringSignalSeniority"));
    const constants = new Map(
      [...section.matchAll(/public const string (\w+) = "(\w+)";/g)].map((match) => [match[1]!, match[2]!]),
    );
    const levels = /Levels \{ get; \} =\s*\[([\s\S]*?)\];/.exec(section)?.[1] ?? "";
    const ordered = [...levels.matchAll(/\((\w+),/g)].map((match) => constants.get(match[1]!));

    expect(ordered).toEqual([...SIGNAL_SENIORITY]);
  });

  it.skipIf(!present)("uses the API's page limits", () => {
    const source = readFileSync(query, "utf8");

    expect(Number(/DefaultLimit = (\d+)/.exec(source)?.[1])).toBe(SIGNAL_DEFAULT_LIMIT);
    expect(Number(/MaxLimit = (\d+)/.exec(source)?.[1])).toBe(SIGNAL_MAX_LIMIT);
    expect(Number(/MaxListValues = (\d+)/.exec(readFileSync(controller, "utf8"))?.[1])).toBe(SIGNAL_MAX_LIST_VALUES);
  });
});
