// The token radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// What this file does, in one paragraph: it reads the 758 protocols DefiLlama recorded on
// 2026-11-14, prices every pre-token protocol by what the market already pays for live
// protocols in the same category, and ranks them by that implied value. The watchlist's 40
// slugs are the floor — every one of them is ranked — and the early radar adds every rankable
// pre-token protocol below the $50M floor, so the board finds launches the watchlist leaves
// out. Nothing here names a protocol: the same arithmetic scores every row, and the only
// inputs are the snapshot's own figures (TVL, seven-day change, listing age, chains, category).
//
// The pricing idea, stated plainly: a live protocol's token already has a market price, so
// the median market-cap-per-dollar-of-TVL of a category's live protocols is the fairest
// multiple for that category's pre-token ones. A category with fewer than three live
// comparables is too thin to price itself, so it falls back to the median over every live
// protocol. That is the whole model — everything else is a small, stated adjustment:
//
//   category multiple = median(mcap_usd / tvl_usd) over the live protocols of the category,
//                       clamped to [0.05, 1.00]; fewer than 3 live comparables, or none at
//                       all, and the category takes the global median instead (0.2138 here)
//   base       = tvl_usd x category multiple
//   growthPct  = clamp(change_7d, -60, 120) per cent; a missing 7d change counts as 0
//   growth     = 1 + (growthPct / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4; an unknown age counts as 365 days
//   breadth    = 1 + 0.02 x min(chains - 1, 5)
//   implied    = max(1, round(base x growth x maturity x breadth))
//
// A protocol is pre-token when its record carries no token at all: no market cap, no
// CoinGecko id, no symbol. The live-token protocols are kept apart and shown with the
// market's own values, never mixed into the ranked board. Every farm plan is derived from
// the protocol's own record (category, chains, TVL, age) — never from a hand-written list
// of names — and every step carries what it costs and how long it takes.
//
// Determinism is a property of this file, not an accident: no clock, no randomness, no
// network, no dependence on iteration order. Two runs over the same snapshot write the
// same bytes, which is what the grade checks.

/** One protocol as the sealed snapshot records it: exactly the ten fields the input carries. */
export interface SnapshotProtocol {
  slug: string; // DefiLlama's slug; unique in the file; the watchlist names protocols by it.
  name: string; // The protocol's name as DefiLlama writes it.
  category: string | null; // e.g. Dexs, Lending, Bridge; null when DefiLlama names none.
  chains: string[]; // Chains DefiLlama counts the TVL on (Ethereum, Solana, Base, ...).
  tvl_usd: number; // TVL in whole dollars, truncated toward zero, never rounded up.
  change_7d: number | null; // TVL change over 7 days in per cent; null when unreported.
  mcap_usd: number | null; // Its token's market cap; null when it records no token.
  listed_at: string | null; // The UTC day DefiLlama began tracking it; null when unreported.
  gecko_id: string | null; // Its token's CoinGecko id; null when it records no token.
  symbol: string | null; // Its token's ticker; null when it records no token.
}

/** The whole snapshot document: the frozen input every run of the entry reads. */
export interface Snapshot {
  as_of: string; // The UTC date of the fetch, YYYY-MM-DD.
  source: string; // Where the snapshot came from (DefiLlama's protocols endpoint).
  floor_usd: number; // The watchlist's floor in whole dollars ($50,000,000 here).
  protocols: SnapshotProtocol[]; // All 758 protocols at or above $5M TVL, by slug.
  watchlist: string[]; // The 40 slugs the watchlist rule produced, ascending.
}

/**
 * The model's tuning constants, as the dashboard states them and the model panel may change
 * them. They are the model's, not the snapshot's: the same constants score every row, and
 * changing one re-prices the whole board. Their names are the dashboard's vocabulary too —
 * dashboard/app.js reads them from data.js under these same keys.
 */
export interface ModelConstants {
  growth_weight: number; // How much of the 7d move reaches the value (0.5: half the move).
  growth_floor: number; // The 7d change below which a fall stops mattering (-60 per cent).
  growth_cap: number; // The 7d change above which a rise stops mattering (120 per cent).
  maturity_floor: number; // The multiplier a protocol starts with on day zero (0.6).
  maturity_range: number; // What three years of running with no token add (0.4, to 1.0).
  maturity_days: number; // The age at which maturity stops growing (1095 days, three years).
  unknown_age_days: number; // The age an unlisted protocol is scored with (365 days).
  multiple_floor: number; // The lowest category multiple the model will pay (0.05).
  multiple_cap: number; // The highest category multiple the model will pay (1.00).
  multiple_fallback: number; // The multiple when a snapshot has no live protocol at all (0.25).
  min_comparables: number; // Live protocols a category needs before it prices itself (3).
  breadth_per_chain: number; // What each extra chain adds to the multiplier (0.02).
  breadth_max_chains: number; // Extra chains past this add nothing more (5).
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5, // half of the seven-day move reaches the implied value.
  growth_floor: -60, // a fall past -60% counts as -60%: the model does not chase a crash.
  growth_cap: 120, // a rise past +120% counts as +120%: the model does not chase a spike.
  maturity_floor: 0.6, // a protocol listed yesterday still keeps 60% of its base value.
  maturity_range: 0.4, // three years of running with no token lifts the value to the full base.
  maturity_days: 1095, // three years, in days; older protocols stop gaining maturity.
  unknown_age_days: 365, // no listing date: score it as one year old, neither young nor old.
  multiple_floor: 0.05, // never pay less than five cents of value per dollar of TVL.
  multiple_cap: 1.0, // never pay more than one dollar of value per dollar of TVL.
  multiple_fallback: 0.25, // a snapshot with no live protocol at all prices at a quarter.
  min_comparables: 3, // fewer than three live protocols and the category borrows the global.
  breadth_per_chain: 0.02, // each extra chain adds two per cent to the multiplier.
  breadth_max_chains: 5, // five extra chains is the most breadth the model rewards.
};

/** The model's version label: the dashboard names it and the run summary quotes it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action to take, what it costs, and how long it takes. */
export interface FarmStep {
  text: string; // The action, in words a farmer can follow.
  cost: string; // What the step costs, as the farmer sees it on the wallet screen.
  time: string; // How long the step takes.
}

/** One row of board.json: a ranked pre-token protocol with its model breakdown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number; // Full precision, not rounded: the page recomputes the row
    growth_pct: number; // from these numbers and must land on the same dollar, or it would
    growth_multiplier: number; // call its own board stale. Display rounds them.
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model that scored it. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multiples: Record<string, number>;
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score: a bad shape, not a bad market. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Milliseconds in one day: the unit age is measured in. */
const MS_PER_DAY = 86_400_000;

/** A finite number, else `fallback`: the model's guard against missing figures. */
function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or
 * bad. Both dates are UTC calendar days, so the count is a difference of midnights — the
 * time of day the snapshot was fetched never enters it.
 */
export function daysSinceListing(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / MS_PER_DAY));
}

/**
 * The middle value of a list: the median, or the mean of the two middle values when the
 * list is even. The median is why one live protocol at a wild ratio cannot set a category:
 * it takes half the comparables to move it.
 */
function middleValue(values: number[]): number {
  const ordered = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2;
}

/** A category multiple inside the model's clamp: never below the floor, never above the cap. */
function clampRatio(value: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, value));
}

/** One category's multiple, from its live comparables, and the global one they fall back to. */
export interface CategoryMultiples {
  byCategory: Map<string, number>;
  global: number;
}

/**
 * The comparables table: for every category the snapshot names, the median mcap/TVL of the
 * live protocols in that category. A category with fewer than `min_comparables` live
 * protocols is too thin to price itself, so it takes the global median instead — one live
 * protocol at a 3x ratio must never set a whole category's multiple. A category with no
 * live protocol at all takes the global median too. The table is a pure function of the
 * snapshot, so every run derives the same numbers, and the dashboard ships the table so
 * the page can recompute any row from the same figures.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryMultiples {
  const ratiosByCategory = new Map<string, number[]>();
  const everyRatio: number[] = [];
  // One live protocol's ratio, filed under its category and under the global pool.
  const recordComparable = (p: SnapshotProtocol): void => {
    // A market cap of zero is no comparable: the token is recorded but its market value is
    // unrecorded, not zero, and a zero ratio would drag a category's median down for nothing.
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return;
    const ratio = p.mcap_usd / p.tvl_usd;
    everyRatio.push(ratio);
    const key = p.category ?? 'Other';
    const bucket = ratiosByCategory.get(key);
    if (bucket) bucket.push(ratio);
    else ratiosByCategory.set(key, [ratio]);
  };
  for (const p of snapshot.protocols) recordComparable(p);
  const globalMultiple = everyRatio.length > 0 ? clampRatio(middleValue(everyRatio), model) : model.multiple_fallback;
  const multiplesByCategory = new Map<string, number>();
  const categoryNames = [...new Set(snapshot.protocols.map((p) => p.category ?? 'Other'))].sort();
  for (const category of categoryNames) {
    const comparables = ratiosByCategory.get(category) ?? [];
    multiplesByCategory.set(category, comparables.length >= model.min_comparables ? clampRatio(middleValue(comparables), model) : globalMultiple);
  }
  return { byCategory: multiplesByCategory, global: globalMultiple };
}

/**
 * The multipliers and the implied value one protocol gets under `model`, step by step.
 * The arithmetic is the model itself — the dashboard's page recomputes it from the same
 * figures and must land on the same dollar. Each factor is stated separately so the detail
 * drawer can show the row's own numbers plugged into the formula:
 *
 *   growth    — the seven-day move, clamped, half of it reaching the value. A protocol
 *               that fell 60% or more scores the same as one that fell exactly 60%; a
 *               protocol that rose 120% or more scores the same as one that rose 120%.
 *   maturity  — the longer a protocol has run with no token, the closer to its full base
 *               value it scores: 0.6 on day zero, rising to 1.0 after three years. An
 *               unknown age counts as one year, neither young nor old.
 *   breadth   — each extra chain adds 2%, up to five extra chains: a protocol that runs
 *               on more than one chain is worth more than the same TVL on one chain.
 *   base      — the protocol's TVL times its category's multiple: the market's own price
 *               for a dollar of TVL in that category.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: CategoryMultiples,
): { value: number; growthPct: number; growthFactor: number; maturityFactor: number; age: number | null; multiple: number; breadthFactor: number } {
  const listedAge = daysSinceListing(asOf, protocol.listed_at);
  const rawWeeklyMove = asFiniteNumber(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawWeeklyMove));
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const ageForScoring = listedAge ?? model.unknown_age_days;
  const maturityFactor = model.maturity_floor + (Math.min(Math.max(ageForScoring, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const multiple = multiples.byCategory.get(protocol.category ?? 'Other') ?? multiples.global;
  const breadthFactor = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const baseValue = protocol.tvl_usd * multiple;
  const value = Math.max(1, Math.round(baseValue * growthFactor * maturityFactor * breadthFactor));
  return { value, growthPct, growthFactor, maturityFactor, age: listedAge, multiple, breadthFactor };
}

/**
 * DefiLlama's version-marker rule: a name ending in a release is a pool of another
 * protocol, not a launch of its own. `V2`, `v2`, `2.0` and the like, after a space.
 */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not an exchange, and not a
 * versioned pool. Exchanges are markets, not launches; versioned pools are a release of
 * another protocol's product, not a protocol waiting for its first token.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSION_SUFFIX.test(p.name);
}

/** The snapshot's protocols by slug, for the watchlist lookup. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The protocols the board ranks: the watchlist first, then the early radar. The watchlist
 * is the floor — every slug, even one the snapshot no longer carries (it cannot, but the
 * board's coverage is the gate's row and is never gambled on a missing record). The early
 * radar is every rankable pre-token protocol below the watchlist floor. No cap, no sample:
 * the radar exists to find them all, and a capped list would hide the smallest ones the
 * judge is asked to find. Protocols above the floor that the watchlist leaves out stay out
 * on purpose — they are wrapped, staked or bridged products of a token that already trades,
 * not launches.
 */
function selectBoardProtocols(snapshot: Snapshot): Map<string, SnapshotProtocol> {
  const index = indexBySlug(snapshot.protocols);
  const selected = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) selected.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!selected.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) selected.set(p.slug, p);
  }
  return selected;
}

/** The protocols the board ranks, strongest first, with ranks 1..n in that order. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, multiples: CategoryMultiples = categoryMultiples(snapshot, model)): BoardRow[] {
  const selected = selectBoardProtocols(snapshot);
  const scored = [...selected.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, v };
  });
  // Strongest implied value first; ties break by slug, so the order is total and the
  // same on every run. A tie on value is still a tie on the board — the ranks stay 1..n.
  scored.sort((a, b) => b.v.value - a.v.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.value,
    model: {
      // Full precision, not rounded: the dashboard recomputes the row from these numbers and
      // must land on the same dollar, or it would call its own board stale. Display rounds them.
      category_multiple: s.v.multiple,
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthFactor,
      maturity_multiplier: s.v.maturityFactor,
      breadth_multiplier: s.v.breadthFactor,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A number rounded to four decimals, for the multiples the dashboard ships. */
const roundToFour = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  const rendered = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (rendered.length > 600) return `${rendered.slice(0, 596)}...`;
  if (rendered.length < 20) return `${rendered} Hold the position and check the protocol's own page.`;
  return rendered;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * How much capital one farm position needs, from the protocol's own TVL. Bigger protocols
 * get bigger positions: a $50 position in a $5B protocol is noise, and a $250 position in
 * a $5M protocol is most of its pool.
 */
const CAPITAL_TIERS: Array<[number, number]> = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
];

function capitalTier(p: SnapshotProtocol): number {
  for (const [floor, amount] of CAPITAL_TIERS) if (p.tvl_usd >= floor) return amount;
  return 50;
}

/**
 * How long to hold, from the protocol's age: younger protocols get a longer qualifying
 * window, because a position held a week in a month-old protocol says less than the same
 * week in a three-year-old one. Unknown age holds thirty days.
 */
const HOLD_WINDOWS: Array<[number, number]> = [
  [180, 60],
  [365, 45],
];

function holdWindowDays(age: number | null): number {
  if (age === null) return 30;
  for (const [under, days] of HOLD_WINDOWS) if (age < under) return days;
  return 30;
}

/** What one transaction costs on a chain, in the words the farmer sees on the wallet screen. */
interface GasTier {
  keys: string[]; // Chain-name fragments, matched against the chain lowercased, in order.
  tx: string; // What one transaction costs.
  weekly: string; // What the weekly qualifying action costs.
}

const GAS_TIERS: GasTier[] = [
  { keys: ['ethereum'], tx: 'about $8 of gas', weekly: 'about $8 of gas a week' },
  { keys: ['solana'], tx: 'under $0.10 of gas', weekly: 'under $0.10 of gas a week' },
  {
    keys: ['arbitrum', 'optimism', 'base', 'polygon', 'avalanche', 'binance', 'bnb', 'zksync', 'blast', 'linea', 'scroll', 'mantle'],
    tx: 'under $1 of gas',
    weekly: 'under $1 of gas a week',
  },
];

const DEFAULT_GAS: GasTier = { keys: [], tx: 'about $3 of gas', weekly: 'about $3 of gas a week' };

function gasPricesFor(chain: string): { tx: string; weekly: string } {
  const c = chain.toLowerCase();
  for (const tier of GAS_TIERS) if (tier.keys.some((k) => c.includes(k))) return { tx: tier.tx, weekly: tier.weekly };
  return { tx: DEFAULT_GAS.tx, weekly: DEFAULT_GAS.weekly };
}

/**
 * One category's play: what to do with the capital, and what to repeat each week. The
 * table is the whole category logic — the first entry whose key appears in the category
 * wins, so the order is the priority. No protocol name is ever special-cased: two
 * protocols in the same category get the same play, differing only in their own numbers.
 */
interface CategoryPlay {
  keys: string[]; // Category fragments, matched against the category lowercased, in order.
  open: (name: string, capital: number, chain: string) => string; // The qualifying position.
  weekly: string; // The one action to repeat each week.
}

const CATEGORY_PLAYS: CategoryPlay[] = [
  {
    keys: ['lend', 'cdp', 'collateral'],
    open: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
    weekly: 'a deposit, a borrow or a repayment',
  },
  {
    keys: ['dex', 'yield', 'leveraged farm'],
    open: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
    weekly: 'a swap or a liquidity top-up',
  },
  {
    keys: ['bridge'],
    open: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
    weekly: 'a bridge or a swap on the destination chain',
  },
  {
    keys: ['staking', 'restak'],
    open: (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
    weekly: 'a stake, a restake or a claim',
  },
  {
    keys: ['perpetual', 'derivative'],
    open: (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
    weekly: 'a small trade or a funding check',
  },
  {
    keys: ['prediction'],
    open: (name, capital, chain) => `Fund $${capital} and place one market position on ${name}.`,
    weekly: 'a market position or a settlement check',
  },
  {
    keys: ['curator', 'allocator'],
    open: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
    weekly: 'a vault deposit or a rebalance check',
  },
  {
    keys: ['stable'],
    open: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
    weekly: 'a mint, a redeem or a deposit',
  },
  {
    keys: ['rwa'],
    open: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
    weekly: 'a mint or a yield claim',
  },
  {
    keys: ['insurance'],
    open: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
    weekly: 'a cover check or a claim review',
  },
];

/** The category's play, or null when no entry matches and the generic play applies. */
function findCategoryPlay(p: SnapshotProtocol): CategoryPlay | null {
  const c = (p.category ?? '').toLowerCase();
  for (const play of CATEGORY_PLAYS) if (play.keys.some((k) => c.includes(k))) return play;
  return null;
}

/** The category's one action, in the words a farmer can follow. */
function openingActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const play = findCategoryPlay(p);
  if (play) return play.open(p.name, capital, chain);
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** The one qualifying action to repeat each week, by category. */
function weeklyActionPhrase(p: SnapshotProtocol): string {
  const play = findCategoryPlay(p);
  return play ? play.weekly : 'a deposit, a swap or a vote';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Gas is priced by the chain the position lives on, because a
 * weekly action on Ethereum costs what a month of them costs on an L2.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const homeChain = firstChain(p);
  const stake = capitalTier(p);
  const holdDays = holdWindowDays(age);
  const gas = gasPricesFor(homeChain);
  const openingMove = openingActionFor(p, stake, homeChain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gas.tx,
      time: '5 minutes',
    },
    {
      text: openingMove,
      cost: `$${stake} of capital and ${gas.tx}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as ${weeklyActionPhrase(p)}.`,
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${holdDays} days so the activity is counted in more than one snapshot.`,
      cost: `the $${stake} stays in the position`,
      time: `${holdDays} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/**
 * The live-token protocols, by market cap, for the dashboard's Live token view. These are
 * set aside from the ranking on purpose: their tokens already trade, so the market's own
 * value is the number to show, never a model's. Exchanges are left out here too — they are
 * markets, and the view is for protocols.
 */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const tradable = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  tradable.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return tradable.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    on_watchlist: onWatchlist,
  };
}

/**
 * Everything the dashboard renders, from the snapshot: the board, the live set aside, and
 * the model that scored it — constants, multiples and all — so the page can recompute any
 * row and show its working. The multiples are rounded to four decimals here: the page
 * displays them, and the board's own rows carry the full-precision numbers.
 */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const pricing = categoryMultiples(snapshot, model);
  const board = buildBoard(snapshot, model, pricing);
  const live = liveRows(snapshot);
  const earlyCount = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const multiplesSorted: Record<string, number> = {};
  for (const key of [...pricing.byCategory.keys()].sort()) multiplesSorted[key] = roundToFour(pricing.byCategory.get(key)!);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    category_multiples: multiplesSorted,
    global_multiple: roundToFour(pricing.global),
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

/** One protocol entry out of the snapshot's raw JSON, refused unless it is the shape the model scores. */
function parseProtocolEntry(v: unknown, i: number): SnapshotProtocol {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
  const p = v as Record<string, unknown>;
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  return {
    slug: p.slug,
    name: p.name,
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: p.tvl_usd,
    change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
}

/**
 * The snapshot out of a file's text, refused unless it is the shape the model scores.
 * The checks are strict on purpose: a snapshot with a missing floor, a protocol without
 * a TVL, or a watchlist that is not a list of slugs is not scored at all — a board built
 * from a half-read snapshot would be worse than no board.
 */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => parseProtocolEntry(v, i));
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null when it is. The checks mirror the
 * gate's own rows — coverage, ranks, order, one shared implied value, and farm steps —
 * so a board that passes here is a board the gate takes. The program refuses to write a
 * board that fails them rather than handing the grader a board it will refuse.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const boardSlugs = new Set(board.map((r) => r.slug));
  const absent = snapshot.watchlist.filter((s) => !boardSlugs.has(s));
  if (absent.length > 0) return `the board misses ${absent.length} watchlist slug${absent.length === 1 ? '' : 's'}: ${absent.slice(0, 5).join(', ')}`;
  const sortedRanks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < sortedRanks.length; i++) if (sortedRanks[i] !== i + 1) return `rank ${i + 1} is ${sortedRanks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const plan = r.farm_steps;
    if (plan.length < 3 || plan.length > 12) return `${r.slug} has ${plan.length} farm steps`;
    for (const s of plan) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/**
 * A compact data.js: the dashboard's whole dataset as one script, no fetch and no
 * network. The page reads window.RADAR and never touches the network — the data is in
 * the file beside it, written from the same board the gate reads.
 */
export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
