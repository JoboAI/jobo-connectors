import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SIGNAL_TYPE_LABELS, describeSignal, signalStrengthBand, signalTypeLabel } from "./signal-summary";
import { SIGNAL_TYPES } from "./signals";

const say = (type: string, details: Record<string, unknown>) => describeSignal({ type, details });

describe("signal type labels", () => {
  it("names every type the API has", () => {
    expect(Object.keys(SIGNAL_TYPE_LABELS)).toEqual([...SIGNAL_TYPES]);
  });

  it("puts a type added later into words rather than failing on it", () => {
    expect(signalTypeLabel("remote_shift")).toBe("Remote shift");
    expect(signalTypeLabel("")).toBe("Signal");
  });

  const catalog = join(
    __dirname, "..", "..", "..", "..",
    "Jobo.Enterprise", "Modules", "Jobo.Enterprise.Module.HiringSignals", "Alerts", "HiringSignalTypeCatalog.cs",
  );

  // In the monorepo only: the API's own labels, read from its source.
  it.skipIf(!existsSync(catalog))("uses the labels the dashboard uses", () => {
    const source = readFileSync(catalog, "utf8");
    const labels = [...source.matchAll(/HiringSignalTypes\.\w+, "([^"]+)",/g)].map((match) => match[1]);

    expect(labels).toEqual(Object.values(SIGNAL_TYPE_LABELS));
  });
});

describe("strength in a word", () => {
  it("reads as one of four bands", () => {
    expect([100, 75, 74, 50, 49, 25, 24, 1].map(signalStrengthBand)).toEqual([
      "Very strong", "Very strong", "Strong", "Strong", "Moderate", "Moderate", "Mild", "Mild",
    ]);
  });
});

describe("one sentence per signal", () => {
  // The same sentences HiringSignalTypeCatalog.Describe writes for the
  // dashboard and the alert emails.
  it.each([
    ["hiring_surge", { new_jobs: 17, baseline_weekly_avg: 3.1 }, "17 new jobs this week vs 3.1 a week normally"],
    ["hiring_surge", { new_jobs: 1, baseline_weekly_avg: 0.04 }, "1 new job this week vs 0 a week normally"],
    ["hiring_surge", { new_jobs: 1200, baseline_weekly_avg: 1050.25 }, "1,200 new jobs this week vs 1,050.3 a week normally"],
    [
      "hiring_slowdown",
      { open_roles: 40, open_roles_before: 90, change_pct: -55.6, compared_to: "2026-09-21" },
      "Open roles down 55.6% since 2026-09-21: 40 now, 90 then",
    ],
    ["new_function", { category: "Sales", new_jobs: 4, lookback_days: 180 }, "4 new jobs in Sales, a first in six months"],
    ["new_function", { category: "Sales", lookback_days: 90 }, "First Sales job in 3 months"],
    ["new_country", { country: "Germany", new_jobs: 1 }, "First job in Germany in six months"],
    ["new_country", { country: "Germany", new_jobs: 3, lookback_days: 45 }, "3 new jobs in Germany, a first in 45 days"],
    ["new_skill", { skill: "Rust", new_jobs: 5 }, "5 new jobs ask for Rust, a first in six months"],
    ["new_skill", { skill: "Rust", named: true }, "First job asking for Rust in six months"],
    ["leadership_hire", { title: "VP of Engineering" }, "Hiring a leader: VP of Engineering"],
    ["first_role", { occupation: "Data Engineer" }, "First Data Engineer role"],
    ["new_technology", { technology: "Snowflake", title: "Data Engineer" }, "First mention of Snowflake, in a Data Engineer role"],
    ["new_technology", { technology: "Snowflake" }, "First mention of Snowflake"],
    [
      "function_surge",
      { category: "Technology", new_jobs: 12, baseline_avg: 2.5, window_days: 14 },
      "12 new Technology jobs in 14 days vs 2.5 normally",
    ],
    ["function_surge", { category: "Technology", new_jobs: 1, baseline_avg: 0.2 }, "1 new Technology job in two weeks vs 0.2 normally"],
    ["new_city", { city: "Austin", region: "Texas", new_jobs: 6 }, "6 new jobs in Austin, Texas, a first there"],
    ["new_city", { city: "Austin" }, "First job in Austin"],
    ["hard_to_fill", { title: "Staff Nurse", days_open: 92, city: "Leeds" }, "Staff Nurse (Leeds) open 92 days"],
    ["hard_to_fill", { title: "Staff Nurse", days_open: 30, reason: "reposted", closed_days: 1 }, "Staff Nurse re-posted after 1 day closed"],
    ["hard_to_fill", { title: "Staff Nurse", days_open: 30, reason: "reposted" }, "Staff Nurse re-posted"],
    ["leadership_role_closed", { title: "Chief Financial Officer", days_open: 61 }, "Chief Financial Officer search closed after 61 days"],
    [
      "hiring_freeze",
      { closed_jobs: 45, open_roles_before: 52, closed_to: "2026-11-15" },
      "45 of 52 open roles removed in the week to 2026-11-15",
    ],
    ["hiring_resumed", { gap_days: 74 }, "First new job in 74 days"],
  ])("%s %j", (type, details, sentence) => {
    expect(say(type, details)).toBe(sentence);
  });

  it("falls back to the type's label when the facts are missing", () => {
    expect(say("hiring_surge", { new_jobs: 17 })).toBe("Hiring surge");
    expect(say("leadership_hire", {})).toBe("Leadership hire");
    expect(describeSignal({ type: "new_city", details: null as never })).toBe("New city");
  });

  it("names a type it does not know instead of failing", () => {
    expect(say("remote_shift", { share: 0.4 })).toBe("Remote shift");
  });
});
