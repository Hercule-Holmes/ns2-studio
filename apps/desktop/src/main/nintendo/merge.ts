/**
 * S19: cross-account aggregation over stored daily summaries.
 * Pure functions — merge semantics = sum per day / per game (no dedup:
 * sessions from different accounts are independent facts).
 */
import type { NintendoStoredDaily } from "./account-store";
import type { NintendoMergedDay, NintendoMergedApp } from "./types";

export function mergeDaily(
  rows: Array<NintendoStoredDaily & { sub: string }>,
): NintendoMergedDay[] {
  const byDate = new Map<string, NintendoMergedDay>();

  for (const row of rows) {
    let day = byDate.get(row.date);
    if (!day) {
      day = { date: row.date, totalSeconds: 0, perAccount: {}, apps: [] };
      byDate.set(row.date, day);
    }
    day.totalSeconds += row.totalSeconds;
    day.perAccount[row.sub] = (day.perAccount[row.sub] ?? 0) + row.totalSeconds;

    for (const app of row.apps) {
      let merged = day.apps.find((a) => a.id === app.id);
      if (!merged) {
        merged = { id: app.id, name: app.name, totalSeconds: 0, perAccount: {} };
        day.apps.push(merged);
      }
      merged.name = merged.name || app.name;
      merged.totalSeconds += app.totalSeconds;
      merged.perAccount[row.sub] = (merged.perAccount[row.sub] ?? 0) + app.totalSeconds;
    }
  }

  const days = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  for (const day of days) {
    day.apps.sort((a, b) => b.totalSeconds - a.totalSeconds);
  }
  return days;
}

/** Range filter on merged days (inclusive, yyyy-MM-dd string compare). */
export function filterRange(
  days: NintendoMergedDay[],
  from?: string,
  to?: string,
): NintendoMergedDay[] {
  return days.filter((day) => {
    if (from && day.date < from) return false;
    if (to && day.date > to) return false;
    return true;
  });
}

export function totalsFor(days: NintendoMergedDay[]): {
  total: number;
  today: number;
  week: number;
} {
  if (days.length === 0) return { total: 0, today: 0, week: 0 };
  const today = days[days.length - 1]!.date;
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekKey = weekStart.toISOString().slice(0, 10);
  let total = 0;
  let week = 0;
  let todaySum = 0;
  for (const day of days) {
    total += day.totalSeconds;
    if (day.date >= weekKey) week += day.totalSeconds;
    if (day.date === today) todaySum += day.totalSeconds;
  }
  return { total, today: todaySum, week };
}
