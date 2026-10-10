import { day, fail, parse } from "../core.js";
export function seasonRange(value, preseason = false) {
  if (!value || value === "all") return null;
  if (!/^20\d{2}$/.test(String(value))) throw fail("Invalid season.");
  const y = Number(value);
  return { from: `${y}-${preseason ? "06" : "07"}-01`, to: `${y + 1}-07-01` };
}
export async function seasonSettings(db) {
  const rows = (
    await db
      .prepare(
        "SELECT key,value FROM settings WHERE key IN ('timezone','include_preseason')",
      )
      .all()
  ).results;
  return Object.fromEntries(rows.map((r) => [r.key, parse(r.value)]));
}
// Convert a calendar boundary in the configured time zone, including DST offsets.
export function dayStart(value, zone = "America/Los_Angeles") {
  day(value);
  const wanted = Date.parse(value + "T00:00:00Z"),
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  let at = wanted;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(
        f.formatToParts(new Date(at)).map((p) => [p.type, p.value]),
      ),
      wall = Date.UTC(
        +p.year,
        +p.month - 1,
        +p.day,
        +p.hour,
        +p.minute,
        +p.second,
      );
    const diff = wanted - wall;
    if (!diff) break;
    at += diff;
  }
  return new Date(at).toISOString();
}
export function localDate(value, zone = "America/Los_Angeles") {
  if (!value) return null;
  if (value.length === 10) return day(value);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
