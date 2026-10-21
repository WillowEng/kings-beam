import { describe, expect, it } from "vitest";
import { calculateStatus } from "../../src/core/beam";
import { CATEGORIES, defaultSettings } from "../../src/core/models";
import { classify } from "../../src/core/eligibility";
import { matchGame } from "../../src/core/matching";
import { nextPacificMidnight, completionDay } from "../../src/core/time";
import { NOW, game, observation, odds, snapshot } from "../support/domain";

describe("classification and independent category controls", () => {
  it.each([
    ["regular", false, null, "regular"], ["regular", false, "West Semifinal", "cup_regular"],
    ["ist", false, "Championship", "cup_championship"], ["playin", false, null, "playin"],
    ["playoffs", true, null, "playoffs"], ["preseason", false, null, "preseason"],
  ] as const)("classifies %s / %s / %s", (queryType, postseason, ist_stage, expected) => {
    expect(classify("1", { postseason, ist_stage }, { queryType }).competition).toBe(expected);
  });
  it("requires per-game vetted reference evidence for unsupported Summer League", () => {
    expect(classify("1", {}, {}).competition).toBe("unknown");
    expect(classify("1", {}, { reference: { gameId: "1", category: "summer_league", source: "vetted-fixture" } }).competition).toBe("summer_league");
    expect(classify("2", {}, { reference: { gameId: "1", category: "summer_league", source: "vetted-fixture" } }).competition).toBe("unknown");
  });
  it.each([
    [{ postseason: false }, {}], [{ postseason: true }, { queryType: "regular" }],
    [{ postseason: false, ist_stage: "Championship" }, { queryType: "regular" }],
    [{ postseason: false, ist_stage: "New Unknown Stage" }, { queryType: "regular" }],
  ] as const)("holds missing or conflicting classification", (data, context) => {
    expect(classify("1", data, context).competition).toBe("unknown");
  });
  it.each(CATEGORIES)("applies the %s switch independently", (category) => {
    const state = snapshot([game([observation({ competition: category, classificationProvenance: "reference:fixture" })])]);
    expect(calculateStatus(state, NOW).beam_on).toBe(category !== "summer_league");
    state.settings.eligibility[category] = true;
    expect(calculateStatus(state, NOW).beam_on).toBe(true);
    state.settings.eligibility[category] = false;
    expect(calculateStatus(state, NOW).beam_on).toBe(false);
  });
  it("does not apply the regular switch to Cup regular games", () => {
    const state = snapshot([game([observation({ competition: "cup_regular", classificationProvenance: "bdl:regular" })])]);
    state.settings.eligibility.regular = false;
    expect(calculateStatus(state, NOW).beam_on).toBe(true);
    state.settings.eligibility.cup_regular = false;
    state.settings.eligibility.regular = true;
    expect(calculateStatus(state, NOW).beam_on).toBe(false);
  });
  it.each(CATEGORIES)("never activates from a %s loss", (competition) => {
    const state = snapshot([game([observation({ competition, classificationProvenance: "reference:fixture", awayScore: 90 })])]);
    state.settings.eligibility[competition] = true;
    expect(calculateStatus(state, NOW).beam_on).toBe(false);
  });
});

describe("Beam publication and verification", () => {
  it("publishes a provisional primary win then dual verification", () => {
    expect(calculateStatus(snapshot(), NOW)).toMatchObject({ beam_on: true, verified: false, source: "balldontlie", last_win: "2026-10-21" });
    expect(calculateStatus(snapshot([game([observation(), odds()])]), NOW)).toMatchObject({ beam_on: true, verified: true, source: "dual" });
  });
  it("allows an Odds-first win only with cached classification", () => {
    const scheduled = observation({ lifecycle: "scheduled", homeScore: null, awayScore: null, observedAt: "2026-10-22T02:00:00.000Z" });
    expect(calculateStatus(snapshot([game([scheduled, odds()])]), NOW)).toMatchObject({ beam_on: true, verified: false, source: "odds_api" });
    expect(calculateStatus(snapshot([game([odds()])]), NOW)).toMatchObject({ beam_on: false, verified: false });
  });
  it("distinguishes lag from conflicting finals", () => {
    const lag = odds({ lifecycle: "scheduled", homeScore: null, awayScore: null });
    expect(calculateStatus(snapshot([game([observation(), lag])]), NOW).beam_on).toBe(true);
    const conflict = odds({ homeScore: 120, awayScore: 110 });
    expect(calculateStatus(snapshot([game([observation(), conflict])]), NOW)).toMatchObject({ beam_on: false, verified: false });
  });
  it("withdraws disputed score-only changes too", () => {
    expect(calculateStatus(snapshot([game([observation(), odds({ awayScore: 111 })])]), NOW).beam_on).toBe(false);
  });
  it("retains other uncontested same-day wins and never lets a loss erase them", () => {
    const conflict = game([observation(), odds({ awayScore: 90 })]);
    const separate = game([observation({ providerGameId: "2" })], { id: "bdl:2" });
    expect(calculateStatus(snapshot([conflict, separate]), NOW)).toMatchObject({ beam_on: true, verified: false });
    const loss = game([observation({ awayScore: 90 }), odds({ awayScore: 90 })]);
    expect(calculateStatus(snapshot([separate, loss]), NOW).beam_on).toBe(true);
    expect(calculateStatus(snapshot([loss]), NOW)).toMatchObject({ beam_on: false, verified: true });
  });
  it("supports strict gating without changing the default", () => {
    const state = snapshot();
    expect(defaultSettings().requireDualAgreementForOn).toBe(false);
    state.settings.requireDualAgreementForOn = true;
    expect(calculateStatus(state, NOW).beam_on).toBe(false);
    state.games[0].observations.push(odds());
    expect(calculateStatus(state, NOW).beam_on).toBe(true);
  });
  it.each(["scheduled", "in_progress", "postponed", "canceled", "other", "unknown"] as const)("never activates from %s", (lifecycle) => {
    expect(calculateStatus(snapshot([game([observation({ lifecycle, homeScore: null, awayScore: null })])]), NOW).beam_on).toBe(false);
  });
  it("does not infer no-game confidence from missing coverage or expired freshness", () => {
    expect(calculateStatus(snapshot([], { coverage: [] }), NOW)).toMatchObject({ beam_on: false, verified: false });
    expect(calculateStatus(snapshot([]), NOW).verified).toBe(true);
    expect(calculateStatus(snapshot([]), "2026-10-22T05:16:00.000Z").verified).toBe(false);
  });
  it("downgrades missing enabled-category coverage, source failure and disabled source", () => {
    const state = snapshot([game([observation(), odds()])]);
    state.coverage[0].categories = ["regular"];
    expect(calculateStatus(state, NOW).verified).toBe(false);
    state.coverage[0].categories = [...CATEGORIES];
    state.failedSources = ["odds_api"];
    expect(calculateStatus(state, NOW)).toMatchObject({ beam_on: true, verified: false });
    state.failedSources = []; state.settings.enabled.odds_api = false;
    expect(calculateStatus(state, NOW).verified).toBe(false);
  });
  it("historical single-source games do not poison current verification", () => {
    const old = observation({ observedAt: "2026-10-20T05:00:00.000Z", scheduledStartAt: "2026-10-20T02:00:00.000Z" });
    const historical = game([old], { id: "old", scheduledStartAt: old.scheduledStartAt });
    expect(calculateStatus(snapshot([historical, game([observation(), odds()])]), NOW).verified).toBe(true);
  });
  it("does not treat future games or another team's results as today's wins", () => {
    const future = game([], { scheduledStartAt: "2026-10-23T02:00:00.000Z" });
    const other = game([observation({ home: "SAS", away: "OKC" })], { home: "SAS", away: "OKC" });
    expect(calculateStatus(snapshot([future, other]), NOW)).toMatchObject({ beam_on: false, verified: true });
  });
});

describe("time and authoritative overrides", () => {
  it.each([
    ["2026-03-08T08:00:00.000Z", "2026-03-09T07:00:00.000Z"],
    ["2026-11-01T07:00:00.000Z", "2026-11-02T08:00:00.000Z"],
    [NOW, "2026-10-22T07:00:00.000Z"],
  ])("expires at the IANA midnight after %s", (now, expected) => {
    expect(nextPacificMidnight(now)).toBe(expected);
  });
  it("expires automatic ON on public reads without cron and retains last win", () => {
    expect(calculateStatus(snapshot(), "2026-10-22T07:00:00.000Z")).toMatchObject({ beam_on: false, last_win: "2026-10-21" });
  });
  it("refuses a completion day across midnight and does not use a late nonfinal as proof", () => {
    const o = observation({ scheduledStartAt: "2026-10-22T06:55:00.000Z", observedAt: "2026-10-22T07:15:00.000Z" });
    const g = game([o], { scheduledStartAt: o.scheduledStartAt });
    expect(calculateStatus(snapshot([g]), o.observedAt)).toMatchObject({ beam_on: false, verified: false, last_win: null });
    expect(completionDay(o.scheduledStartAt, o.observedAt, "2026-10-22T07:05:00.000Z")).toBe("2026-10-22");
  });
  it.each(["FORCE_ON", "FORCE_OFF"] as const)("keeps %s authoritative over disagreements", (mode) => {
    const state = snapshot([game([observation(), odds({ awayScore: 90 })])], { override: { mode, createdAt: NOW, expiresAt: nextPacificMidnight(NOW) } });
    expect(calculateStatus(state, NOW)).toMatchObject({ beam_on: mode === "FORCE_ON", verified: false, mode: mode === "FORCE_ON" ? "manual_on" : "manual_off", source: "manual" });
    expect(calculateStatus(state, nextPacificMidnight(NOW)).mode).toBe("auto");
  });
  it("manual-only expires safely and AUTO clears an override", () => {
    const state = snapshot(); state.settings.manualOnly = true;
    expect(calculateStatus(state, NOW)).toMatchObject({ beam_on: false, mode: "manual_only", verified: false });
    state.override = { mode: "FORCE_ON", createdAt: NOW, expiresAt: nextPacificMidnight(NOW) };
    expect(calculateStatus(state, NOW)).toMatchObject({ beam_on: true, mode: "manual_only" });
    expect(calculateStatus(state, nextPacificMidnight(NOW)).beam_on).toBe(false);
    state.settings.manualOnly = false; state.override = { mode: "AUTO", createdAt: NOW, expiresAt: null };
    expect(calculateStatus(state, NOW).mode).toBe("auto");
  });
});

describe("canonical matching", () => {
  it("accepts differing starts only with unique home/away identity", () => {
    expect(matchGame(odds(), [game()])?.id).toBe("bdl:9900001");
    expect(matchGame(odds(), [game(), game([], { id: "other" })])).toBeNull();
    expect(matchGame(odds({ home: "SAC", away: "LAC" }), [game()])).toBeNull();
    expect(matchGame(odds({ scheduledStartAt: "2026-10-23T02:30:00.000Z" }), [game()])).toBeNull();
  });
});

it("holds last_win unknown when a newer recovery interval could contain a later win", () => {
  const old = game([observation({ scheduledStartAt: "2026-10-20T02:00:00.000Z", observedAt: "2026-10-20T05:00:00.000Z" })], { scheduledStartAt: "2026-10-20T02:00:00.000Z" });
  const input = snapshot([old], { historyGaps: [{ start: "2026-10-20", end: "2026-10-21" }] });
  expect(calculateStatus(input, NOW).last_win).toBeNull();
  expect(calculateStatus({ ...input, games: [old, game()] }, NOW).last_win).toBe("2026-10-21");
});

it("distinguishes historical recovery gaps from unresolved gaps affecting the current day", () => {
  const input = snapshot([game([observation(), odds()])], { historyGaps: [{ start: "2026-10-01", end: "2026-10-19" }] });
  expect(calculateStatus(input, NOW).verified).toBe(true);
  expect(calculateStatus({ ...input, historyGaps: [{ start: "2026-10-20", end: "2026-10-21" }] }, NOW).verified).toBe(false);
});
