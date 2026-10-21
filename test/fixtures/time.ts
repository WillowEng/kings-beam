// Synthetic clock scenarios, not game completion evidence.
export const pacificScenarios = [
  { name: "summer before midnight", utc: "2026-10-22T06:59:59.000Z", date: "2026-10-21", time: "23:59:59" },
  { name: "summer midnight", utc: "2026-10-22T07:00:00.000Z", date: "2026-10-22", time: "00:00:00" },
  { name: "winter before midnight", utc: "2026-01-16T07:59:59.000Z", date: "2026-01-15", time: "23:59:59" },
  { name: "winter midnight", utc: "2026-01-16T08:00:00.000Z", date: "2026-01-16", time: "00:00:00" },
  { name: "before spring jump", utc: "2026-03-08T09:59:59.000Z", date: "2026-03-08", time: "01:59:59" },
  { name: "after spring jump", utc: "2026-03-08T10:00:00.000Z", date: "2026-03-08", time: "03:00:00" },
  { name: "before fall repeat", utc: "2026-11-01T08:59:59.000Z", date: "2026-11-01", time: "01:59:59" },
  { name: "after fall repeat", utc: "2026-11-01T09:00:00.000Z", date: "2026-11-01", time: "01:00:00" },
] as const;

export const pacificDayIntervals = [
  { name: "spring transition", start: "2026-03-08T08:00:00.000Z", end: "2026-03-09T07:00:00.000Z", hours: 23 },
  { name: "fall transition", start: "2026-11-01T07:00:00.000Z", end: "2026-11-02T08:00:00.000Z", hours: 25 },
] as const;
