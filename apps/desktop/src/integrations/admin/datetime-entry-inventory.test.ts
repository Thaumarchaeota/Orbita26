import { describe, expect, it } from "vitest";

export type DatetimeEntryRow = {
  surface: string;
  file: string;
  control: string;
  valueType: string;
  tzOwner: string;
  migrated: boolean;
};

export const DATETIME_ENTRY_INVENTORY: DatetimeEntryRow[] = [
  {
    surface: "AI tool confirm (Insight / inline)",
    file: "integrations/ai/tool-confirm.ts",
    control: "ui/date-picker + ui/time-picker",
    valueType: "YYYY-MM-DD / HH:mm",
    tzOwner: "Beijing journal domain (ADR-0020)",
    migrated: true,
  },
  {
    surface: "Journal today panel meal dialog",
    file: "integrations/journal/meals-dialog.ts",
    control: "ui/date-picker + ui/time-picker",
    valueType: "YYYY-MM-DD / HH:mm",
    tzOwner: "Beijing (meal date + at)",
    migrated: true,
  },
  {
    surface: "Journal today panel note dialog",
    file: "integrations/journal/today-panel.ts",
    control: "ui/date-picker",
    valueType: "YYYY-MM-DD",
    tzOwner: "Beijing → UTC ISO on save",
    migrated: true,
  },
  {
    surface: "Health meal history date filter",
    file: "integrations/admin/tabs/health/meal-history.ts",
    control: "ui/date-picker",
    valueType: "YYYY-MM-DD localDateFrom/To",
    tzOwner: "Health DB local date",
    migrated: true,
  },
  {
    surface: "Insight meal compose",
    file: "integrations/admin/tabs/meal-compose.ts",
    control: "ui/date-picker + ui/time-picker",
    valueType: "YYYY-MM-DD / HH:mm",
    tzOwner: "Asia/Shanghai (nowShanghai)",
    migrated: true,
  },
  {
    surface: "Health tracks date rail",
    file: "integrations/admin/timeline/health-tracks-view.ts",
    control: "ui/date-picker",
    valueType: "YYYY-MM-DD",
    tzOwner: "Beijing selectedDate",
    migrated: true,
  },
  {
    surface: "Productivity item compose plan row",
    file: "integrations/admin/tabs/item-compose.ts",
    control: "ui/date-picker + ui/time-picker",
    valueType: "UTC RFC3339 instants",
    tzOwner: "dateTimeToUnix / unixToLocal",
    migrated: true,
  },
  {
    surface: "Task item detail range",
    file: "integrations/admin/tabs/task/item-detail.ts",
    control: "ui/date-picker + ui/time-picker",
    valueType: "UTC RFC3339 instants",
    tzOwner: "dateTimeToUnix / unixToLocal",
    migrated: true,
  },
  {
    surface: "Timeline action tracks editor",
    file: "integrations/admin/timeline/action-tracks-view.ts",
    control: "ui/date-picker + ui/time-picker",
    valueType: "UTC RFC3339 instants",
    tzOwner: "dateTimeToUnix / unixToLocal",
    migrated: true,
  },
  {
    surface: "TickTick task dialog",
    file: "integrations/ticktick/dialog.ts",
    control: "ticktick/form-pickers (local)",
    valueType: "date label / HH:mm",
    tzOwner: "TickTick local",
    migrated: false,
  },
  {
    surface: "Insight journal entry tab started",
    file: "integrations/admin/tabs/journal.ts",
    control: "ui/date-picker + ui/time-picker",
    valueType: "YYYY-MM-DD / HH:mm",
    tzOwner: "UTC ISO",
    migrated: true,
  },
  {
    surface: "Journal tracks inline editor",
    file: "integrations/admin/timeline/journal-tracks-view.ts",
    control: "ui/date-picker + ui/time-picker",
    valueType: "YYYY-MM-DD / HH:mm",
    tzOwner: "local datetime-local",
    migrated: true,
  },
  {
    surface: "Project action plan (blank page)",
    file: "integrations/admin/tabs/project.ts",
    control: "native datetime-local",
    valueType: "ISO instant",
    tzOwner: "UTC RFC3339",
    migrated: false,
  },
];

describe("datetime entry inventory", () => {
  it("covers migrated and skipped surfaces", () => {
    const migrated = DATETIME_ENTRY_INVENTORY.filter((row) => row.migrated);
    const skipped = DATETIME_ENTRY_INVENTORY.filter((row) => !row.migrated);
    expect(migrated.length).toBeGreaterThan(0);
    expect(skipped.length).toBeGreaterThan(0);
  });

  it.each(DATETIME_ENTRY_INVENTORY.map((row, index) => [index, row] as const))(
    "row %i documents %s",
    (_index, row) => {
      expect(row.file).toMatch(/\.ts$/);
      expect(row.control.length).toBeGreaterThan(0);
      expect(row.valueType.length).toBeGreaterThan(0);
      expect(row.tzOwner.length).toBeGreaterThan(0);
    },
  );
});
