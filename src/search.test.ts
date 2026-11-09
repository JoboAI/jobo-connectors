import { describe, expect, it } from "vitest";
import { JOB_SEARCH_FILTERS } from "./filters";
import { toJobSearchBody, toList } from "./search";
import type { JobSearchFilters } from "./types";

describe("toJobSearchBody", () => {
  it("maps every connector key onto the POST /api/jobs/search body", () => {
    const body = toJobSearchBody(
      {
        q: " rust engineer ",
        location: "Berlin, Germany",
        sources: ["greenhouse"],
        companies: ["stripe.com", "0d5f8b4e-1111-4c2a-9a55-2f6d1f0e7a10"],
        exclude_companies: ["Acme"],
        work_model: ["remote"],
        employment_type: ["full-time"],
        experience_level: ["senior"],
        language: ["en", "de"],
        skills: ["Rust"],
        exclude_skills: ["PHP"],
        industries: ["Software Development"],
        exclude_industries: ["Staffing and Recruiting"],
        company_categories: ["saas"],
        exclude_company_categories: ["agency"],
        job_categories: ["Technology"],
        exclude_job_categories: ["Healthcare"],
        job_subcategories: ["Software Engineering"],
        exclude_job_subcategories: ["Nursing"],
        occupation_ids: ["jobo:backend-developer"],
        exclude_occupation_ids: ["esco:8d3e8aaa-791b-4c75-a465-f3f827028f50"],
        min_salary_usd: 100000,
        max_salary_usd: 200000,
        posted_after: "2026-11-01T00:00:00Z",
        posted_before: "2026-11-08T00:00:00Z",
        discovered_after: "2026-11-02T00:00:00Z",
        discovered_before: "2026-11-09T00:00:00Z",
        search_description: false,
        sort: "discovered_desc",
        description_format: "html",
      },
      { page: 2, page_size: 50, include_fields: ["summary"] },
    );

    expect(body).toEqual({
      queries: ["rust engineer"],
      search_description: false,
      locations: ["Berlin, Germany"],
      sources: ["greenhouse"],
      work_models: ["remote"],
      employment_types: ["full-time"],
      experience_levels: ["senior"],
      languages: ["en", "de"],
      skills: { include: ["Rust"], exclude: ["PHP"] },
      companies: { include: ["stripe.com", "0d5f8b4e-1111-4c2a-9a55-2f6d1f0e7a10"], exclude: ["Acme"] },
      industries: { include: ["Software Development"], exclude: ["Staffing and Recruiting"] },
      company_categories: { include: ["saas"], exclude: ["agency"] },
      job_categories: { include: ["Technology"], exclude: ["Healthcare"] },
      job_subcategories: { include: ["Software Engineering"], exclude: ["Nursing"] },
      occupation_ids: {
        include: ["jobo:backend-developer"],
        exclude: ["esco:8d3e8aaa-791b-4c75-a465-f3f827028f50"],
      },
      salary_usd: { min: 100000, max: 200000 },
      posted_after: "2026-11-01T00:00:00Z",
      posted_before: "2026-11-08T00:00:00Z",
      discovered_after: "2026-11-02T00:00:00Z",
      discovered_before: "2026-11-09T00:00:00Z",
      sort: "discovered_desc",
      description_format: "html",
      page: 2,
      page_size: 50,
      include_fields: ["summary"],
    });
  });

  it("covers every contract search filter", () => {
    // Every key must change the body when set; a key the mapper ignores is
    // a filter the user sets and the API never sees.
    const sample: Record<string, unknown> = {};
    for (const filter of JOB_SEARCH_FILTERS) {
      switch (filter.kind) {
        case "string":
        case "dateTime":
          sample[filter.key] = "2026-11-01T00:00:00Z";
          break;
        case "number":
          sample[filter.key] = 1000;
          break;
        case "boolean":
          sample[filter.key] = false;
          break;
        case "enum":
          sample[filter.key] = filter.options![filter.options!.length - 1];
          break;
        default:
          sample[filter.key] = ["value"];
      }
    }
    for (const filter of JOB_SEARCH_FILTERS) {
      const without = { ...sample };
      delete without[filter.key];
      expect(
        JSON.stringify(toJobSearchBody(sample as JobSearchFilters)),
        `filter "${filter.key}" is not mapped`,
      ).not.toBe(JSON.stringify(toJobSearchBody(without as JobSearchFilters)));
    }
  });

  it("leaves out empty values and API defaults", () => {
    expect(
      toJobSearchBody({
        q: "  ",
        location: "",
        sources: [],
        skills: [" ", ""],
        exclude_skills: [],
        min_salary_usd: 0,
        max_salary_usd: 0,
        search_description: true,
        sort: "relevance",
        description_format: "markdown",
      }),
    ).toEqual({});
  });

  it("keeps include_facets tri-state", () => {
    expect(toJobSearchBody({}, { include_facets: [] })).toEqual({ include_facets: [] });
    expect(toJobSearchBody({})).toEqual({});
  });

  it("drops duplicate and blank list entries", () => {
    expect(toJobSearchBody({ companies: ["a", " a ", "", "b"] }).companies).toEqual({ include: ["a", "b"] });
  });
});

describe("toList", () => {
  it("splits a string on commas and newlines", () => {
    expect(toList("python, go\nrust,,")).toEqual(["python", "go", "rust"]);
  });

  it("keeps array entries whole, commas included", () => {
    expect(toList(["Oil, Gas and Mining", "Software"])).toEqual(["Oil, Gas and Mining", "Software"]);
  });

  it("returns undefined for nothing", () => {
    expect(toList(undefined)).toBeUndefined();
    expect(toList([])).toBeUndefined();
    expect(toList("")).toBeUndefined();
  });
});
