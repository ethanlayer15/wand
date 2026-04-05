import { describe, it, expect } from "vitest";

// ── Tag parsing utility (mirrors the logic in billingRouter.ts) ─────────────

function parseTags(tagsJson: string | null | undefined): string[] {
  try {
    return JSON.parse(tagsJson || "[]") as string[];
  } catch {
    return [];
  }
}

// ── Tag filter logic (mirrors the filteredTasks useMemo in Billing.tsx) ─────

interface Property {
  id: string;
  name: string;
  tags: string[];
}

interface Task {
  id: number;
  home_id: number;
  type_department?: string;
}

function filterTasksByTags(
  tasks: Task[],
  properties: Property[],
  selectedTags: string[]
): Task[] {
  if (selectedTags.length === 0) return tasks;
  return tasks.filter((t) => {
    const prop = properties.find((p) => p.id === String(t.home_id));
    const propTags = prop?.tags ?? [];
    return selectedTags.every((tag) => propTags.includes(tag));
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseTags", () => {
  it("parses a valid JSON array of strings", () => {
    expect(parseTags('["Hot tub service","Leisr Billing"]')).toEqual([
      "Hot tub service",
      "Leisr Billing",
    ]);
  });

  it("returns empty array for null", () => {
    expect(parseTags(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTags("")).toEqual([]);
  });

  it("returns empty array for '[]'", () => {
    expect(parseTags("[]")).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseTags("{bad json}")).toEqual([]);
  });

  it("handles tags with spaces and special characters", () => {
    expect(parseTags('["Sauna ","Firepit ","1/26 MAKE INACTIVE"]')).toEqual([
      "Sauna ",
      "Firepit ",
      "1/26 MAKE INACTIVE",
    ]);
  });
});

describe("filterTasksByTags", () => {
  const properties: Property[] = [
    { id: "100", name: "Cabin A", tags: ["Hot tub service", "Leisr Billing"] },
    { id: "200", name: "Cabin B", tags: ["Weekly Billing WNC"] },
    { id: "300", name: "Cabin C", tags: [] },
    { id: "400", name: "Cabin D", tags: ["Hot tub service", "Weekly Billing WNC"] },
  ];

  const tasks: Task[] = [
    { id: 1, home_id: 100 },
    { id: 2, home_id: 200 },
    { id: 3, home_id: 300 },
    { id: 4, home_id: 400 },
    { id: 5, home_id: 999 }, // unknown property
  ];

  it("returns all tasks when no tags selected", () => {
    expect(filterTasksByTags(tasks, properties, [])).toHaveLength(5);
  });

  it("filters to tasks with a single tag", () => {
    const result = filterTasksByTags(tasks, properties, ["Hot tub service"]);
    expect(result.map((t) => t.id)).toEqual([1, 4]);
  });

  it("filters to tasks with multiple tags (AND logic)", () => {
    const result = filterTasksByTags(tasks, properties, [
      "Hot tub service",
      "Weekly Billing WNC",
    ]);
    expect(result.map((t) => t.id)).toEqual([4]);
  });

  it("excludes tasks whose property has no tags when tag is selected", () => {
    const result = filterTasksByTags(tasks, properties, ["Hot tub service"]);
    const ids = result.map((t) => t.id);
    expect(ids).not.toContain(3); // Cabin C has no tags
  });

  it("excludes tasks with unknown property when tag is selected", () => {
    const result = filterTasksByTags(tasks, properties, ["Hot tub service"]);
    const ids = result.map((t) => t.id);
    expect(ids).not.toContain(5); // property 999 not in list
  });

  it("returns empty when no properties match the selected tag", () => {
    const result = filterTasksByTags(tasks, properties, ["Nonexistent Tag"]);
    expect(result).toHaveLength(0);
  });

  it("returns tasks for a tag only one property has", () => {
    const result = filterTasksByTags(tasks, properties, ["Leisr Billing"]);
    expect(result.map((t) => t.id)).toEqual([1]);
  });
});

describe("distinct tags from property list", () => {
  it("collects unique tags across all properties", () => {
    const props = [
      { tags: '["Hot tub service","Leisr Billing"]' },
      { tags: '["Leisr Billing","Weekly Billing WNC"]' },
      { tags: "[]" },
      { tags: null },
    ];

    const tagSet = new Set<string>();
    for (const p of props) {
      parseTags(p.tags).forEach((t) => t && tagSet.add(t));
    }

    const sorted = Array.from(tagSet).sort();
    expect(sorted).toEqual(["Hot tub service", "Leisr Billing", "Weekly Billing WNC"]);
  });
});
