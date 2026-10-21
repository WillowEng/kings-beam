import { CATEGORIES, type Category, type Competition } from "./models";
export type QueryType = "regular" | "playoffs" | "playin" | "preseason" | "ist";
export interface ClassificationContext {
  queryType?: QueryType;
  reference?: { gameId: string; category: Category; source: string };
}
const cupStages = ["East Group A", "East Group B", "East Group C", "West Group A", "West Group B", "West Group C", "East Quarterfinal", "West Quarterfinal", "East Semifinal", "West Semifinal"];
export function classify(gameId: string, data: Record<string, unknown>, context: ClassificationContext): { competition: Competition; classificationProvenance: string | null } {
  const unknown = { competition: "unknown" as const, classificationProvenance: null };
  const stage = data.ist_stage;
  let category: Category | undefined;
  if (context.queryType === "regular" && data.postseason === false) {
    if (stage === "Championship") return unknown;
    if (typeof stage === "string" && !cupStages.includes(stage)) return unknown;
    if (stage !== undefined && stage !== null && typeof stage !== "string") return unknown;
    category = typeof stage === "string" ? "cup_regular" : "regular";
  }
  if (context.queryType === "ist" && stage === "Championship" && data.postseason === false) category = "cup_championship";
  if (context.queryType === "playoffs" && data.postseason === true && stage == null) category = "playoffs";
  if ((context.queryType === "preseason" || context.queryType === "playin") && data.postseason === false && stage == null) category = context.queryType;
  const ref = context.reference;
  if (ref && ref.gameId === gameId && CATEGORIES.includes(ref.category) && /^[a-z0-9_-]{1,64}$/.test(ref.source)) {
    if (category && category !== ref.category) return unknown;
    return { competition: ref.category, classificationProvenance: `reference:${ref.source}` };
  }
  return category ? { competition: category, classificationProvenance: `bdl:${context.queryType}` } : unknown;
}
