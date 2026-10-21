/** Reduced reconstruction from prior Stage A output, NOT a raw response capture. */
export const observedEvidence = {
  provenance: {
    kind: "observed-reconstruction",
    observedOn: "2026-10-21",
    note: "Selected fields from prior successful Stage A requests; no new calls. Not evidence of latency, completion time, or season-wide coverage.",
  },
  balldontlie: {
    data: [{
      id: 21717857, season: 2026, date: "2026-10-20", status: "Final",
      status_state: "final", postseason: false, ist_stage: null,
      datetime: "2026-10-21T01:30:00.000Z",
      home_team: { id: 27, full_name: "San Antonio Spurs" },
      visitor_team: { id: 21, full_name: "Oklahoma City Thunder" },
      home_team_score: 104, visitor_team_score: 116,
    }],
  },
  oddsApi: [{
    id: "bccd283de56915e29af1788beb0abfc9", sport_key: "basketball_nba", sport_title: "NBA",
    commence_time: "2026-10-21T01:52:15Z", completed: true,
    home_team: "San Antonio Spurs", away_team: "Oklahoma City Thunder",
    scores: [{ name: "San Antonio Spurs", score: "104" }, { name: "Oklahoma City Thunder", score: "116" }],
    last_update: "2026-10-21T09:51:56Z",
  }],
} as const;
