const rows: Array<[string, string, string[]]> = [
  ["ATL", "Atlanta Hawks", []], ["BOS", "Boston Celtics", []], ["BKN", "Brooklyn Nets", []], ["CHA", "Charlotte Hornets", []],
  ["CHI", "Chicago Bulls", []], ["CLE", "Cleveland Cavaliers", []], ["DAL", "Dallas Mavericks", []], ["DEN", "Denver Nuggets", []],
  ["DET", "Detroit Pistons", []], ["GSW", "Golden State Warriors", []], ["HOU", "Houston Rockets", []], ["IND", "Indiana Pacers", []],
  ["LAC", "Los Angeles Clippers", ["LA Clippers"]], ["LAL", "Los Angeles Lakers", []], ["MEM", "Memphis Grizzlies", []],
  ["MIA", "Miami Heat", []], ["MIL", "Milwaukee Bucks", []], ["MIN", "Minnesota Timberwolves", []], ["NOP", "New Orleans Pelicans", []],
  ["NYK", "New York Knicks", []], ["OKC", "Oklahoma City Thunder", []], ["ORL", "Orlando Magic", []], ["PHI", "Philadelphia 76ers", []],
  ["PHX", "Phoenix Suns", []], ["POR", "Portland Trail Blazers", []], ["SAC", "Sacramento Kings", []], ["SAS", "San Antonio Spurs", []],
  ["TOR", "Toronto Raptors", []], ["UTA", "Utah Jazz", []], ["WAS", "Washington Wizards", []],
];
export const TEAMS = rows.map(([id, name, aliases], index) => ({ id, name, aliases: [name, ...aliases], bdlId: index + 1 }));
export function canonicalName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  return TEAMS.find(t => t.aliases.some(a => a.toLowerCase() === name.trim().toLowerCase()))?.id ?? null;
}
export function canonicalBdl(team: Record<string, unknown>): string | null {
  const mapped = TEAMS.find(t => t.bdlId === team.id);
  return mapped && canonicalName(team.full_name) === mapped.id ? mapped.id : null;
}
