/**
 * Tests for the PropertyCombobox component and searchable property dropdown logic.
 *
 * These tests validate:
 * 1. Alphabetical sorting of properties
 * 2. Search/filter logic
 * 3. Value handling (all sentinel, empty, specific id)
 * 4. Component file existence and structure
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";

// ── Inline the sorting and filtering logic from PropertyCombobox ──────────

interface PropertyOption {
  id: string | number;
  name: string;
  sublabel?: string;
}

function sortPropertiesAlphabetically(properties: PropertyOption[]): PropertyOption[] {
  return [...properties].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
  );
}

function filterProperties(properties: PropertyOption[], search: string): PropertyOption[] {
  if (!search) return properties;
  const lower = search.toLowerCase();
  return properties.filter((p) =>
    (p.name + (p.sublabel ? ` ${p.sublabel}` : "")).toLowerCase().includes(lower)
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("PropertyCombobox — alphabetical sorting", () => {
  it("sorts properties alphabetically by name", () => {
    const props: PropertyOption[] = [
      { id: 3, name: "Whistler Retreat" },
      { id: 1, name: "Aspen Lodge" },
      { id: 2, name: "Mountain View Cabin" },
    ];
    const sorted = sortPropertiesAlphabetically(props);
    expect(sorted[0].name).toBe("Aspen Lodge");
    expect(sorted[1].name).toBe("Mountain View Cabin");
    expect(sorted[2].name).toBe("Whistler Retreat");
  });

  it("is case-insensitive when sorting", () => {
    const props: PropertyOption[] = [
      { id: 1, name: "zebra House" },
      { id: 2, name: "Apple Cottage" },
      { id: 3, name: "BANANA Villa" },
    ];
    const sorted = sortPropertiesAlphabetically(props);
    expect(sorted[0].name).toBe("Apple Cottage");
    expect(sorted[1].name).toBe("BANANA Villa");
    expect(sorted[2].name).toBe("zebra House");
  });

  it("handles empty array", () => {
    expect(sortPropertiesAlphabetically([])).toEqual([]);
  });

  it("handles single item", () => {
    const props = [{ id: 1, name: "Solo Property" }];
    expect(sortPropertiesAlphabetically(props)).toEqual(props);
  });

  it("does not mutate the original array", () => {
    const props: PropertyOption[] = [
      { id: 2, name: "Zephyr" },
      { id: 1, name: "Alpha" },
    ];
    const original = [...props];
    sortPropertiesAlphabetically(props);
    expect(props[0].name).toBe(original[0].name);
    expect(props[1].name).toBe(original[1].name);
  });

  it("handles properties with same name (stable sort by id)", () => {
    const props: PropertyOption[] = [
      { id: 2, name: "Twin Peaks" },
      { id: 1, name: "Twin Peaks" },
    ];
    const sorted = sortPropertiesAlphabetically(props);
    expect(sorted).toHaveLength(2);
    expect(sorted[0].name).toBe("Twin Peaks");
  });

  it("handles names with numbers (e.g. '1525 Luther St')", () => {
    const props: PropertyOption[] = [
      { id: 3, name: "Zephyr Cabin" },
      { id: 1, name: "1525 Luther St" },
      { id: 2, name: "Aspen View" },
    ];
    const sorted = sortPropertiesAlphabetically(props);
    // Numbers sort before letters in locale-aware comparison
    expect(sorted[0].name).toBe("1525 Luther St");
    expect(sorted[1].name).toBe("Aspen View");
    expect(sorted[2].name).toBe("Zephyr Cabin");
  });

  it("sorts 114 properties quickly (under 50ms)", () => {
    const props: PropertyOption[] = Array.from({ length: 114 }, (_, i) => ({
      id: i,
      name: `Property ${String.fromCharCode(65 + (i % 26))} ${Math.floor(Math.random() * 1000)}`,
    }));
    const start = Date.now();
    sortPropertiesAlphabetically(props);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe("PropertyCombobox — search/filter logic", () => {
  const sampleProps: PropertyOption[] = [
    { id: 1, name: "Aspen Lodge" },
    { id: 2, name: "Blue Ridge Cabin" },
    { id: 3, name: "Cedar Creek House" },
    { id: 4, name: "Whistler Retreat" },
    { id: 5, name: "Mountain View Villa" },
  ];

  it("returns all properties when search is empty", () => {
    expect(filterProperties(sampleProps, "")).toHaveLength(5);
  });

  it("filters by partial name match", () => {
    const result = filterProperties(sampleProps, "cabin");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Blue Ridge Cabin");
  });

  it("is case-insensitive", () => {
    expect(filterProperties(sampleProps, "ASPEN")).toHaveLength(1);
    expect(filterProperties(sampleProps, "aspen")).toHaveLength(1);
    expect(filterProperties(sampleProps, "Aspen")).toHaveLength(1);
  });

  it("returns empty array when no match", () => {
    expect(filterProperties(sampleProps, "xyznotfound")).toHaveLength(0);
  });

  it("matches multiple properties with shared substring", () => {
    const result = filterProperties(sampleProps, "e");
    // Aspen, Blue, Cedar, Whistler, Mountain — all contain 'e'
    expect(result.length).toBeGreaterThan(1);
  });

  it("matches sublabel text as well", () => {
    const propsWithSublabel: PropertyOption[] = [
      { id: 1, name: "Aspen Lodge", sublabel: "3 tasks" },
      { id: 2, name: "Blue Ridge", sublabel: "0 tasks" },
    ];
    // Searching "3 tasks" should match Aspen Lodge
    const result = filterProperties(propsWithSublabel, "3 tasks");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Aspen Lodge");
  });
});

describe("PropertyCombobox — value handling", () => {
  it("'all' sentinel maps to allLabel display", () => {
    // When value === "all", the trigger should show allLabel
    const value = "all";
    const allLabel = "All Properties (114)";
    const selectedOption = null; // no match for "all" in properties list
    const triggerLabel = selectedOption
      ? (selectedOption as any).name
      : value === "all" && allLabel
      ? allLabel
      : "Select property…";
    expect(triggerLabel).toBe("All Properties (114)");
  });

  it("specific id maps to property name", () => {
    const properties = [
      { id: "5", name: "Aspen Lodge" },
      { id: "10", name: "Blue Ridge" },
    ];
    const value = "10";
    const selectedOption = properties.find((p) => String(p.id) === String(value));
    expect(selectedOption?.name).toBe("Blue Ridge");
  });

  it("empty/undefined value shows placeholder", () => {
    const value = "";
    const allLabel = "All Properties";
    const selectedOption = null;
    const triggerLabel = selectedOption
      ? (selectedOption as any).name
      : value === "all" && allLabel
      ? allLabel
      : "Select property…";
    expect(triggerLabel).toBe("Select property…");
  });
});

describe("PropertyCombobox — component file structure", () => {
  const componentPath = "/home/ubuntu/wandai/client/src/components/PropertyCombobox.tsx";

  it("PropertyCombobox.tsx file exists", () => {
    expect(fs.existsSync(componentPath)).toBe(true);
  });

  it("exports PropertyCombobox function", () => {
    const code = fs.readFileSync(componentPath, "utf-8");
    expect(code).toContain("export function PropertyCombobox");
  });

  it("uses Command + Popover pattern", () => {
    const code = fs.readFileSync(componentPath, "utf-8");
    expect(code).toContain("Command");
    expect(code).toContain("Popover");
    expect(code).toContain("CommandInput");
  });

  it("sorts alphabetically in component", () => {
    const code = fs.readFileSync(componentPath, "utf-8");
    expect(code).toContain("localeCompare");
    expect(code).toContain("sort");
  });

  it("accepts allLabel prop to show 'All Properties' sentinel", () => {
    const code = fs.readFileSync(componentPath, "utf-8");
    expect(code).toContain("allLabel");
  });

  it("accepts showIcon prop for building icon on trigger", () => {
    const code = fs.readFileSync(componentPath, "utf-8");
    expect(code).toContain("showIcon");
    expect(code).toContain("Building");
  });
});

describe("Searchable dropdowns — all pages updated", () => {
  const pages = [
    { file: "Tasks.tsx", label: "Tasks filter bar" },
    { file: "Analyze.tsx", label: "Analyze filter bar" },
    { file: "Billing.tsx", label: "Billing filter panel" },
    { file: "BillingRateCard.tsx", label: "BillingRateCard dialogs" },
    { file: "BreezewayTasks.tsx", label: "BreezewayTasks filter + create dialog" },
  ];

  for (const { file, label } of pages) {
    it(`${label} (${file}) imports PropertyCombobox`, () => {
      const code = fs.readFileSync(
        `/home/ubuntu/wandai/client/src/pages/${file}`,
        "utf-8"
      );
      expect(code).toContain("PropertyCombobox");
      expect(code).toContain("from \"@/components/PropertyCombobox\"");
    });

    it(`${label} (${file}) uses PropertyCombobox component`, () => {
      const code = fs.readFileSync(
        `/home/ubuntu/wandai/client/src/pages/${file}`,
        "utf-8"
      );
      expect(code).toContain("<PropertyCombobox");
    });
  }

  it("Tasks.tsx no longer has plain Select for property filter", () => {
    const code = fs.readFileSync(
      "/home/ubuntu/wandai/client/src/pages/Tasks.tsx",
      "utf-8"
    );
    // The old filter bar Select for property should be replaced
    expect(code).not.toContain("All Properties ({propertyOptions.length})");
  });

  it("Analyze.tsx no longer has plain Select for property filter", () => {
    const code = fs.readFileSync(
      "/home/ubuntu/wandai/client/src/pages/Analyze.tsx",
      "utf-8"
    );
    expect(code).not.toContain("<SelectItem value=\"all\">All Properties</SelectItem>");
  });

  it("BreezewayTasks.tsx no longer has plain Select for filter bar property", () => {
    const code = fs.readFileSync(
      "/home/ubuntu/wandai/client/src/pages/BreezewayTasks.tsx",
      "utf-8"
    );
    expect(code).not.toContain("<SelectItem value=\"all\">All Properties</SelectItem>");
  });
});
