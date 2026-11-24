/**
 * Hiring signals in words: a label for each type and one plain sentence for a
 * signal, built from its `details`.
 *
 * The API returns the facts and leaves the wording to the reader. Jobo's own
 * dashboard and alert emails render them with
 * `HiringSignalTypeCatalog.Describe` (Jobo.Enterprise.Module.HiringSignals);
 * this is the same wording, so a Slack message built in a workflow reads like
 * the alert Jobo would have sent. Keep the two in step.
 */
import type { HiringSignal } from "./types";

/** A short name for each signal type, as the dashboard shows it. */
export const SIGNAL_TYPE_LABELS: Readonly<Record<string, string>> = {
  hiring_surge: "Hiring surge",
  new_function: "New function",
  new_country: "New country",
  leadership_hire: "Leadership hire",
  new_skill: "New skill",
  hiring_slowdown: "Hiring slowdown",
  first_role: "First role",
  new_technology: "New technology",
  function_surge: "Function surge",
  new_city: "New city",
  hard_to_fill: "Hard to fill",
  leadership_role_closed: "Leadership role closed",
  hiring_freeze: "Hiring freeze",
  hiring_resumed: "Hiring resumed",
};

/** The label of a type, or the type in words for one added after this was written. */
export function signalTypeLabel(type: string): string {
  const known = SIGNAL_TYPE_LABELS[type];
  if (known) return known;
  const words = String(type ?? "").replace(/_/g, " ").trim();
  return words.length === 0 ? "Signal" : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Strength in a word. Strength runs from 1 to 100 and compares signals of one
 * type, so it reads better as one of four bands than as a score.
 */
export function signalStrengthBand(strength: number): "Very strong" | "Strong" | "Moderate" | "Mild" {
  if (strength >= 75) return "Very strong";
  if (strength >= 50) return "Strong";
  if (strength >= 25) return "Moderate";
  return "Mild";
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  // Half away from zero, as the API rounds.
  return (Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9)) / factor;
}

function grouped(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function whole(value: number): string {
  return grouped(String(round(value, 0)));
}

/** At most one decimal, and none when it would be ".0". */
function decimal(value: number): string {
  const [integer = "0", fraction] = String(round(value, 1)).split(".");
  return fraction ? `${grouped(integer)}.${fraction}` : grouped(integer);
}

function counted(count: number, noun: string): string {
  return Math.abs(count - 1) < 0.0001 ? `1 ${noun}` : `${whole(count)} ${noun}s`;
}

function lookback(days: number | null): string {
  if (days == null || days <= 0) return "six months";
  if (days < 60) return `${whole(days)} days`;
  const months = round(days / 30, 0);
  return months === 6 ? "six months" : `${months} months`;
}

/**
 * One plain sentence for a signal, e.g. "17 new jobs this week vs 3.1 a week
 * normally". Falls back to the type's label when `details` lacks the facts
 * the sentence needs, or the type is one this version does not know.
 */
export function describeSignal(signal: Pick<HiringSignal, "type" | "details">): string {
  const type = signal.type;
  const details = signal.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return signalTypeLabel(type);

  const number = (name: string): number | null => {
    const value = (details as Record<string, unknown>)[name];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const text = (name: string): string | null => {
    const value = (details as Record<string, unknown>)[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };

  const newJobs = number("new_jobs");
  const period = lookback(number("lookback_days"));

  switch (type) {
    case "hiring_surge": {
      const baseline = number("baseline_weekly_avg");
      if (newJobs == null || baseline == null) break;
      return `${counted(newJobs, "new job")} this week vs ${decimal(baseline)} a week normally`;
    }
    case "hiring_slowdown": {
      const now = number("open_roles");
      const before = number("open_roles_before");
      if (now == null || before == null) break;
      const drop = Math.abs(number("change_pct") ?? 0);
      const day = text("compared_to");
      return `Open roles down ${decimal(drop)}%${day ? ` since ${day}` : ""}: ${whole(now)} now, ${whole(before)} then`;
    }
    case "new_function": {
      const category = text("category");
      if (!category) break;
      return newJobs != null && newJobs > 1
        ? `${counted(newJobs, "new job")} in ${category}, a first in ${period}`
        : `First ${category} job in ${period}`;
    }
    case "new_country": {
      const country = text("country");
      if (!country) break;
      return newJobs != null && newJobs > 1
        ? `${counted(newJobs, "new job")} in ${country}, a first in ${period}`
        : `First job in ${country} in ${period}`;
    }
    case "new_skill": {
      const skill = text("skill");
      if (!skill) break;
      return newJobs != null && newJobs > 1
        ? `${whole(newJobs)} new jobs ask for ${skill}, a first in ${period}`
        : `First job asking for ${skill} in ${period}`;
    }
    case "leadership_hire": {
      const title = text("title");
      if (!title) break;
      return `Hiring a leader: ${title}`;
    }
    case "first_role": {
      const occupation = text("occupation");
      if (!occupation) break;
      return `First ${occupation} role`;
    }
    case "new_technology": {
      const technology = text("technology");
      if (!technology) break;
      const role = text("title");
      return role ? `First mention of ${technology}, in a ${role} role` : `First mention of ${technology}`;
    }
    case "function_surge": {
      const category = text("category");
      const usual = number("baseline_avg");
      if (!category || newJobs == null || usual == null) break;
      const days = number("window_days");
      return `${counted(newJobs, `new ${category} job`)} in ${days != null ? `${whole(days)} days` : "two weeks"} vs ${decimal(usual)} normally`;
    }
    case "new_city": {
      const city = text("city");
      if (!city) break;
      const region = text("region");
      const place = region ? `${city}, ${region}` : city;
      return newJobs != null && newJobs > 1 ? `${counted(newJobs, "new job")} in ${place}, a first there` : `First job in ${place}`;
    }
    case "hard_to_fill": {
      const title = text("title");
      const open = number("days_open");
      if (!title || open == null) break;
      const city = text("city");
      const at = city ? ` (${city})` : "";
      if (text("reason") !== "reposted") return `${title}${at} open ${counted(open, "day")}`;
      const closed = number("closed_days");
      return closed != null && closed > 0 ? `${title}${at} re-posted after ${counted(closed, "day")} closed` : `${title}${at} re-posted`;
    }
    // Says the posting ended, never that anyone was hired.
    case "leadership_role_closed": {
      const title = text("title");
      const open = number("days_open");
      if (!title || open == null) break;
      return `${title} search closed after ${counted(open, "day")}`;
    }
    case "hiring_freeze": {
      const removed = number("closed_jobs");
      const had = number("open_roles_before");
      if (removed == null || had == null) break;
      const last = text("closed_to");
      return `${whole(removed)} of ${counted(had, "open role")} removed${last ? ` in the week to ${last}` : ""}`;
    }
    case "hiring_resumed": {
      const gap = number("gap_days");
      if (gap == null) break;
      return `First new job in ${counted(gap, "day")}`;
    }
    default:
      break;
  }

  return signalTypeLabel(type);
}
