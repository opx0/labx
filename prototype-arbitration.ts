// ============================================================================
// THROWAWAY PROTOTYPE — signal arbitration for the Learning OS.
// Not production code. No persistence. No deps. Delete when the question is
// settled.
//
// QUESTION: four signals (mastery gap, retention deadline, calibration,
// misconception) each independently propose "what next", and the Session
// Governor can veto. Nothing in the blueprint says who wins. Does this
// compose into sane decisions, or does it thrash / starve?
//
//   bun prototype-arbitration.ts                    # interactive
//   bun prototype-arbitration.ts selftest           # the one runnable check
//   bun prototype-arbitration.ts scenario <name>    # one scripted collision
// ============================================================================

// ---------------------------------------------------------------- fixture ---

type Intensity = "light" | "medium" | "hard";
const RANK: Record<Intensity, number> = { light: 0, medium: 1, hard: 2 };
const BY_RANK: Intensity[] = ["light", "medium", "hard"];

const MASTERY = 0.7; // the "known" threshold everything is measured against

type ConceptDef = { id: string; label: string; prereqs: string[] };

const CONCEPTS: ConceptDef[] = [
  { id: "bs_invariant", label: "loop invariant / which half dies", prereqs: [] },
  { id: "bs_bounds", label: "inclusive vs exclusive hi", prereqs: ["bs_invariant"] },
  { id: "bs_lower_bound", label: "first occurrence (leftmost)", prereqs: ["bs_bounds"] },
  { id: "bs_upper_bound", label: "last occurrence (rightmost)", prereqs: ["bs_bounds"] },
  { id: "bs_rotated", label: "search in rotated sorted array", prereqs: ["bs_bounds", "bs_lower_bound"] },
];

type Item = { id: string; concept: string; difficulty: number; intensity: Intensity };

const ITEMS: Item[] = [
  { id: "inv_which_half", concept: "bs_invariant", difficulty: 0.2, intensity: "light" },
  { id: "inv_terminates", concept: "bs_invariant", difficulty: 0.5, intensity: "medium" },
  { id: "bnd_hi_len_or_len1", concept: "bs_bounds", difficulty: 0.3, intensity: "light" },
  { id: "bnd_empty_range", concept: "bs_bounds", difficulty: 0.6, intensity: "medium" },
  { id: "lb_first_occurrence", concept: "bs_lower_bound", difficulty: 0.5, intensity: "medium" },
  { id: "lb_all_duplicates", concept: "bs_lower_bound", difficulty: 0.8, intensity: "hard" },
  { id: "ub_last_occurrence", concept: "bs_upper_bound", difficulty: 0.5, intensity: "medium" },
  { id: "ub_insert_position", concept: "bs_upper_bound", difficulty: 0.7, intensity: "hard" },
  { id: "rot_find_pivot", concept: "bs_rotated", difficulty: 0.8, intensity: "hard" },
  { id: "rot_with_duplicates", concept: "bs_rotated", difficulty: 0.9, intensity: "hard" },
];

type Misconception = {
  id: string;
  concept: string;
  description: string;
  contains: string[]; // any of these
  notContains: string[]; // and none of these
  detectionConfidence: number;
  socratic: string;
  targetedItem: string;
};

const MISCONCEPTIONS: Misconception[] = [
  {
    id: "lower_bound_as_plain_bs",
    concept: "bs_lower_bound",
    description: "finds any match then linear-scans left instead of biasing the search",
    contains: ["scan back", "walk left", "then go left", "linear scan"],
    notContains: ["invariant", "hi = mid"],
    detectionConfidence: 0.85,
    socratic: "If half the array is the target value, how many steps does your scan-back take?",
    targetedItem: "lb_all_duplicates",
  },
  {
    id: "off_by_one_hi",
    concept: "bs_lower_bound",
    description: "uses hi = mid - 1 in a lower_bound loop, discarding the answer",
    contains: ["hi = mid - 1", "hi=mid-1", "high = mid - 1"],
    notContains: ["upper", "last occurrence"],
    detectionConfidence: 0.75,
    socratic: "What invariant guarantees you kept the leftmost occurrence in range?",
    targetedItem: "lb_first_occurrence",
  },
  {
    id: "mid_overflow",
    concept: "bs_bounds",
    description: "computes (lo+hi)/2 with no overflow guard",
    contains: ["(lo + hi) / 2", "(lo+hi)/2", "(low + high) / 2"],
    notContains: ["overflow", "lo + (hi"],
    detectionConfidence: 0.6,
    socratic: "What does lo + hi do when both are near the integer max?",
    targetedItem: "bnd_empty_range",
  },
  {
    id: "rotated_needs_sort",
    concept: "bs_rotated",
    description: "believes a rotated array must be sorted first",
    contains: ["sort it first", "sort the array", "need it sorted"],
    notContains: ["already sorted in two", "pivot"],
    detectionConfidence: 0.9,
    socratic: "The rotated array is two sorted runs. Which run is mid in?",
    targetedItem: "rot_find_pivot",
  },
];

// ------------------------------------------------------------------ state ---

type ConceptState = {
  pL: number;
  halfLifeDays: number;
  calibration: number; // >0 overconfident, <0 underconfident
  calibSamples: number;
  attempts: number;
  active: { id: string; day: number }[];
  lastTouchedDay: number | null;
};

type Ev = { id: string; day: number; kind: string; detail: string };

type Candidate = {
  key: string;
  type: "practice" | "review" | "prove_it" | "evidence_surface" | "remediate";
  concept: string;
  intensity: Intensity;
  urgency: number;
  item: string | null;
  why: string;
  evidence: string[];
};

type Policy = {
  maxIntensity: Intensity;
  allowNewMaterial: boolean;
  maxItems: number;
  breakDue: boolean;
  reasons: string[];
};

type Veto = { cand: Candidate; reason: string };

type ActionLog = {
  id: string;
  day: number;
  chosen: Candidate | { type: "break"; why: string } | null;
  policy: Policy;
  considered: Candidate[];
  vetoed: Veto[];
  evidence: string[];
};

class World {
  day = 0;
  interviewDay = 9;
  sleepHours = 8;
  load: "light" | "heavy" = "light";
  concepts = new Map<string, ConceptState>();
  events: Ev[] = [];
  actions: ActionLog[] = [];
  // in-session
  sessionResults: boolean[] = [];
  consecutiveHigh = 0;
  itemsDone = 0;
  // starvation bookkeeping
  deferrals = new Map<string, number>();
  // the two rules under test
  flags = { misconceptionExempt: true, starvationEscalation: true };

  constructor() {
    for (const c of CONCEPTS) {
      this.concepts.set(c.id, {
        pL: 0.15,
        halfLifeDays: 1.5,
        calibration: 0,
        calibSamples: 0,
        attempts: 0,
        active: [],
        lastTouchedDay: null,
      });
    }
  }

  ev(kind: string, detail: string): string {
    const id = `evt_${String(this.events.length + 1).padStart(4, "0")}`;
    this.events.push({ id, day: this.day, kind, detail });
    return id;
  }

  cs(id: string): ConceptState {
    const s = this.concepts.get(id);
    if (!s) throw new Error(`no concept ${id}`);
    return s;
  }

  prereqsMet(id: string): boolean {
    const def = CONCEPTS.find((c) => c.id === id)!;
    return def.prereqs.every((p) => this.cs(p).pL >= MASTERY);
  }

  seen(id: string): boolean {
    return this.cs(id).attempts > 0;
  }
}

// -------------------------------------------------------------------- BKT ---

const P_SLIP = 0.1;
const P_GUESS = 0.2;
const P_TRANSIT = 0.25;

function bktUpdate(pL: number, correct: boolean, difficulty: number): number {
  // difficulty makes slipping likelier and guessing harder
  const slip = Math.min(0.45, P_SLIP + difficulty * 0.25);
  const guess = Math.max(0.02, P_GUESS * (1 - difficulty));

  let post: number;
  if (correct) {
    const pc = pL * (1 - slip) + (1 - pL) * guess;
    post = (pL * (1 - slip)) / pc;
  } else {
    const pw = pL * slip + (1 - pL) * (1 - guess);
    post = (pL * slip) / pw;
  }
  return post + (1 - post) * P_TRANSIT;
}

function decay(pL: number, halfLife: number, days: number): number {
  return pL * Math.pow(0.5, days / halfLife);
}

/** days until pL falls under `threshold`, given the half-life. 0 if already under. */
function daysUntilBelow(pL: number, halfLife: number, threshold = MASTERY): number {
  if (pL <= threshold) return 0;
  return halfLife * Math.log2(pL / threshold);
}

function answer(w: World, itemId: string, correct: boolean, conf: number): void {
  const item = ITEMS.find((i) => i.id === itemId);
  if (!item) {
    console.log(`  ! no such item: ${itemId}`);
    console.log(`    items: ${ITEMS.map((i) => i.id).join(", ")}`);
    return;
  }
  const s = w.cs(item.concept);
  const before = s.pL;

  s.pL = bktUpdate(s.pL, correct, item.difficulty);
  s.attempts++;
  s.lastTouchedDay = w.day;

  // successful spaced retrieval stretches the half-life; a miss shrinks it
  s.halfLifeDays = correct
    ? Math.min(30, s.halfLifeDays * 1.35 + 0.2)
    : Math.max(0.8, s.halfLifeDays * 0.6);

  // calibration: self-rated confidence vs what actually happened
  const claimed = conf / 4;
  const actual = correct ? 1 : 0;
  const a = 0.4;
  s.calibration = s.calibSamples === 0 ? claimed - actual : s.calibration * (1 - a) + (claimed - actual) * a;
  s.calibSamples++;

  w.sessionResults.push(correct);
  w.itemsDone++;
  w.consecutiveHigh = RANK[item.intensity] >= 1 ? w.consecutiveHigh + 1 : 0;

  const eid = w.ev(
    correct ? "answer_correct" : "answer_incorrect",
    `${itemId} conf=${conf} pL ${before.toFixed(2)}->${s.pL.toFixed(2)}`,
  );
  console.log(
    `  ${correct ? "correct" : "INCORRECT"}  ${itemId} (conf ${conf})  ` +
      `${item.concept} pL ${before.toFixed(2)} -> ${s.pL.toFixed(2)}  ` +
      `hl ${s.halfLifeDays.toFixed(1)}d  [${eid}]`,
  );
}

/** scenario setup is *history*, not the live session — reset the in-session counters
 *  so an unrelated governor rule (break, accuracy collapse) doesn't mask the collision. */
function newSession(w: World): void {
  w.sessionResults = [];
  w.itemsDone = 0;
  w.consecutiveHigh = 0;
}

function advance(w: World, days: number): void {
  for (const [id, s] of w.concepts) {
    const before = s.pL;
    s.pL = decay(s.pL, s.halfLifeDays, days);
    if (before - s.pL > 0.005) {
      console.log(`  decay ${id.padEnd(15)} ${before.toFixed(2)} -> ${s.pL.toFixed(2)} (hl ${s.halfLifeDays.toFixed(1)}d)`);
    }
  }
  w.day += days;
  // a new day is a new session
  w.sessionResults = [];
  w.itemsDone = 0;
  w.consecutiveHigh = 0;
  w.ev("clock_advance", `+${days}d -> day ${w.day}`);
}

// ----------------------------------------------------------------- critic ---

function critic(w: World, text: string): void {
  const lower = text.toLowerCase();
  let fired = 0;
  for (const m of MISCONCEPTIONS) {
    const hit = m.contains.find((c) => lower.includes(c.toLowerCase()));
    if (!hit) continue;
    const blocked = m.notContains.find((n) => lower.includes(n.toLowerCase()));
    if (blocked) {
      console.log(`  - ${m.id} matched "${hit}" but suppressed by "${blocked}"`);
      continue;
    }
    const s = w.cs(m.concept);
    if (s.active.some((a) => a.id === m.id)) {
      console.log(`  = ${m.id} already active on ${m.concept}`);
      continue;
    }
    s.active.push({ id: m.id, day: w.day });
    const eid = w.ev("misconception_detected", `${m.id} on ${m.concept} via "${hit}"`);
    console.log(`  TRIGGERED ${m.id} (conf ${m.detectionConfidence}) on ${m.concept}`);
    console.log(`    matched: "${hit}"   missing: ${m.notContains.map((n) => `"${n}"`).join(", ")}   [${eid}]`);
    fired++;
  }
  if (fired === 0) console.log("  no misconception triggers fired");
}

// -------------------------------------------------------- candidate gen'rs ---

/** deepest unmet prereq of `id`, or null if all met. ponytail: no cycle guard, fixture is a DAG. */
function rootBlocker(w: World, id: string): string | null {
  const def = CONCEPTS.find((c) => c.id === id)!;
  for (const p of def.prereqs) {
    if (w.cs(p).pL < MASTERY) return rootBlocker(w, p) ?? p;
  }
  return null;
}

function genGap(w: World): Candidate[] {
  // FINDING 1 FIX: silently dropping prereq-blocked concepts froze their
  // starvation counters (they vanished from `considered`), so escalation was
  // dead code exactly when it was needed. Instead, redirect the blocked gap's
  // urgency onto the concept that is actually blocking it.
  // FINDING 5: aggregate the blocked-downstream set per target, otherwise the
  // audit trail degenerates into "pL 0.61 under 0.7" repeated five times.
  const blocking = new Map<string, string[]>();

  for (const def of CONCEPTS) {
    if (w.cs(def.id).pL >= MASTERY) continue;
    const target = rootBlocker(w, def.id) ?? def.id;
    const list = blocking.get(target) ?? [];
    if (target !== def.id) list.push(def.id);
    blocking.set(target, list);
  }

  return [...blocking.entries()].map(([target, blocked]) => {
    const ts = w.cs(target);
    const item = ITEMS.filter((i) => i.concept === target).sort((a, b) => a.difficulty - b.difficulty)[0];
    return {
      key: `gap:${target}`,
      type: "practice" as const,
      concept: target,
      intensity: item.intensity,
      // a blocker holding up N downstream concepts should outrank a lone gap
      urgency: MASTERY - ts.pL + Math.min(0.25, blocked.length * 0.08),
      item: item.id,
      why:
        `pL ${ts.pL.toFixed(2)} under ${MASTERY}` +
        (blocked.length ? `, blocking ${blocked.length}: ${blocked.join(", ")}` : ""),
      evidence: [],
    };
  });
}

function genRetention(w: World): Candidate[] {
  const out: Candidate[] = [];
  const daysLeft = w.interviewDay - w.day;
  for (const def of CONCEPTS) {
    const s = w.cs(def.id);
    if (s.pL < MASTERY) continue;
    const until = daysUntilBelow(s.pL, s.halfLifeDays);
    if (until > daysLeft) continue; // holds through the interview, leave it alone
    out.push({
      key: `retention:${def.id}`,
      type: "review",
      concept: def.id,
      intensity: "light",
      urgency: 0.75 / (until + 0.6),
      item: ITEMS.filter((i) => i.concept === def.id)[0].id,
      why: `pL ${s.pL.toFixed(2)} crosses ${MASTERY} in ${until.toFixed(1)}d, interview in ${daysLeft}d`,
      evidence: [],
    });
  }
  return out;
}

function genCalibration(w: World): Candidate[] {
  const out: Candidate[] = [];
  for (const def of CONCEPTS) {
    const s = w.cs(def.id);
    if (s.calibSamples < 2 || Math.abs(s.calibration) <= 0.25) continue;
    const over = s.calibration > 0;
    const hard = ITEMS.filter((i) => i.concept === def.id).sort((a, b) => b.difficulty - a.difficulty)[0];
    out.push({
      key: `calib:${def.id}`,
      type: over ? "prove_it" : "evidence_surface",
      concept: def.id,
      intensity: over ? "hard" : "light",
      urgency: Math.abs(s.calibration),
      item: over ? hard.id : null,
      why: over
        ? `overconfident +${s.calibration.toFixed(2)}, adversarial transfer task`
        : `underconfident ${s.calibration.toFixed(2)}, surface past successes`,
      evidence: [],
    });
  }
  return out;
}

function genMisconception(w: World): Candidate[] {
  const out: Candidate[] = [];
  for (const def of CONCEPTS) {
    const s = w.cs(def.id);
    for (const a of s.active) {
      const m = MISCONCEPTIONS.find((x) => x.id === a.id)!;
      const stale = Math.min(0.3, (w.day - a.day) * 0.05);
      out.push({
        key: `misc:${a.id}`,
        type: "remediate",
        concept: def.id,
        intensity: "medium",
        urgency: 0.9 * m.detectionConfidence + stale,
        item: m.targetedItem,
        why: `active "${m.id}" for ${w.day - a.day}d`,
        evidence: w.events.filter((e) => e.detail.includes(m.id)).map((e) => e.id),
      });
    }
  }
  return out;
}

// --------------------------------------------------------------- governor ---

function governor(w: World): Policy {
  const p: Policy = {
    maxIntensity: "hard",
    allowNewMaterial: true,
    maxItems: 12,
    breakDue: false,
    reasons: [],
  };

  if (w.sleepHours < 5 || w.load === "heavy") {
    p.maxIntensity = "light";
    p.allowNewMaterial = false;
    p.maxItems = 6;
    p.reasons.push(`CONSOLIDATE (sleep ${w.sleepHours}h, load ${w.load})`);
  } else if (w.sleepHours < 7) {
    p.maxIntensity = "medium";
    p.maxItems = 9;
    p.reasons.push(`reduced ceiling (sleep ${w.sleepHours}h)`);
  }

  // mid-session collapse: opening 3 vs latest 3
  if (w.sessionResults.length >= 5) {
    const open = w.sessionResults.slice(0, 3);
    const recent = w.sessionResults.slice(-3);
    const acc = (xs: boolean[]) => xs.filter(Boolean).length / xs.length;
    const drop = acc(open) - acc(recent);
    if (drop > 0.25) {
      p.maxIntensity = BY_RANK[Math.max(0, RANK[p.maxIntensity] - 1)];
      p.maxItems = w.itemsDone + 2;
      p.reasons.push(
        `accuracy ${(acc(open) * 100).toFixed(0)}% -> ${(acc(recent) * 100).toFixed(0)}%, ceiling downgraded`,
      );
    }
  }

  if (w.consecutiveHigh >= 3) {
    p.breakDue = true;
    p.reasons.push(`${w.consecutiveHigh} consecutive medium+ items, break due`);
  }

  if (p.reasons.length === 0) p.reasons.push("nominal");
  return p;
}

// ---------------------------------------------------------------- arbiter ---

function arbitrate(w: World): ActionLog {
  const policy = governor(w);
  const considered = [...genMisconception(w), ...genCalibration(w), ...genRetention(w), ...genGap(w)];
  const vetoed: Veto[] = [];
  const survivors: Candidate[] = [];

  // FINDING 4: when overconfidence AND a misconception fire on the same concept,
  // the misconception is *why* they are overconfident. Racing them on urgency
  // hands a hard adversarial task to someone with a diagnosed reasoning bug,
  // which just buys another confident failure. Remediation is a precondition.
  const misconceived = new Set(considered.filter((c) => c.type === "remediate").map((c) => c.concept));

  for (const c of considered) {
    if (c.type === "prove_it" && misconceived.has(c.concept)) {
      vetoed.push({ cand: c, reason: `gated: clear the misconception on ${c.concept} first` });
      continue;
    }
    const starved = (w.deferrals.get(c.key) ?? 0) >= 3;
    const escalated = w.flags.starvationEscalation && starved;
    const exempt = w.flags.misconceptionExempt && c.type === "remediate";

    if (RANK[c.intensity] > RANK[policy.maxIntensity]) {
      if (exempt) {
        // survives the ceiling, but downgraded to a light socratic prompt
        survivors.push({ ...c, intensity: policy.maxIntensity, why: c.why + " [exempt, downgraded to socratic]" });
        continue;
      }
      if (escalated) {
        survivors.push({
          ...c,
          urgency: c.urgency + 0.4,
          why: c.why + ` [starved ${w.deferrals.get(c.key)}x, escalated]`,
        });
        continue;
      }
      vetoed.push({ cand: c, reason: `intensity ${c.intensity} > ceiling ${policy.maxIntensity}` });
      continue;
    }

    if (!policy.allowNewMaterial && c.type === "practice" && !w.seen(c.concept)) {
      if (escalated) {
        survivors.push({ ...c, urgency: c.urgency + 0.4, why: c.why + ` [starved, escalated]` });
        continue;
      }
      vetoed.push({ cand: c, reason: "new material forbidden by governor" });
      continue;
    }

    survivors.push(c);
  }

  survivors.sort((a, b) => b.urgency - a.urgency || a.concept.localeCompare(b.concept));
  const winner = survivors[0] ?? null;

  // FINDING 2 FIX: a break used to short-circuit the whole arbiter, so the log
  // never recorded which signals were in flight when it fired. Now the break
  // overrides the *winner* but the candidate/veto trace is still logged.
  const chosen: ActionLog["chosen"] = policy.breakDue
    ? { type: "break", why: "governor: adaptive break enforced" }
    : winner;
  if (policy.breakDue) {
    for (const c of survivors) vetoed.push({ cand: c, reason: "deferred: break enforced" });
  }

  // starvation bookkeeping: winner resets, everyone else accrues.
  // a break defers everyone, so nobody resets.
  for (const c of considered) {
    if (!policy.breakDue && winner && c.key === winner.key) w.deferrals.set(c.key, 0);
    else w.deferrals.set(c.key, (w.deferrals.get(c.key) ?? 0) + 1);
  }

  const log: ActionLog = {
    id: `sys_act_${String(w.actions.length + 1).padStart(4, "0")}`,
    day: w.day,
    chosen,
    policy,
    considered,
    vetoed,
    evidence: chosen?.evidence ?? [],
  };
  w.actions.push(log);
  return log;
}

// ------------------------------------------------------------------ apply ---

// FINDING 3: the first cut arbitrated in a vacuum — nothing ever executed the
// chosen action, so pL only ever decayed and every multi-session scenario
// collapsed no matter what the arbiter decided. A closed loop has to apply it.
/** deterministic stand-in for the learner doing the chosen item. */
function apply(w: World, log: ActionLog): void {
  const c = log.chosen;
  if (!c) return;
  if (!("key" in c)) {
    w.ev("break_compliance", "break taken");
    console.log("  [break taken]");
    w.consecutiveHigh = 0;
    return;
  }
  if (c.type === "evidence_surface") {
    w.ev("coach_evidence_surfaced", `past successes shown for ${c.concept}`);
    console.log(`  [coach surfaced past successes for ${c.concept}]`);
    return;
  }
  if (!c.item) return;

  const item = ITEMS.find((i) => i.id === c.item)!;
  // ponytail: deterministic performance model — they land it if mastery clears
  // the item's difficulty. Keeps selftest reproducible; a real run would sample.
  const correct = w.cs(c.concept).pL >= 0.35 + item.difficulty * 0.4;
  const conf = w.cs(c.concept).calibration > 0.25 ? 4 : 3;
  answer(w, item.id, correct, conf);

  if (correct && c.type === "remediate") {
    const s = w.cs(c.concept);
    const cleared = s.active.shift();
    if (cleared) {
      w.ev("misconception_cleared", `${cleared.id} on ${c.concept}`);
      console.log(`  [misconception cleared: ${cleared.id}]`);
    }
  }
}

// ----------------------------------------------------------------- output ---

function sign(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function printState(w: World): void {
  console.log("");
  console.log(`day ${w.day}   interview day ${w.interviewDay} (${w.interviewDay - w.day}d out)   sleep ${w.sleepHours}h   load ${w.load}   flags: exempt=${w.flags.misconceptionExempt} escalate=${w.flags.starvationEscalation}`);
  console.log("CONCEPT          P(L)   half-life  calib   prereq  flags");
  for (const def of CONCEPTS) {
    const s = w.cs(def.id);
    const flags = s.active.length ? s.active.map((a) => a.id).join(",") : "-";
    console.log(
      `${def.id.padEnd(16)} ${s.pL.toFixed(2)}   ${(s.halfLifeDays.toFixed(1) + "d").padEnd(9)}  ` +
        `${sign(s.calibration).padEnd(7)} ${(w.prereqsMet(def.id) ? "ok" : "BLOCKED").padEnd(7)} ${flags}`,
    );
  }
}

function printDecision(w: World, log: ActionLog): void {
  console.log("");
  console.log(`GOVERNOR: ${log.policy.reasons.join(" | ")}`);
  console.log(
    `  ceiling=${log.policy.maxIntensity}  newMaterial=${log.policy.allowNewMaterial}  maxItems=${log.policy.maxItems}  breakDue=${log.policy.breakDue}`,
  );

  console.log("CANDIDATES:");
  if (log.considered.length === 0) console.log("  (none)");
  for (const c of [...log.considered].sort((a, b) => b.urgency - a.urgency)) {
    const v = log.vetoed.find((x) => x.cand.key === c.key);
    const mark = v ? "VETO" : "    ";
    const starve = w.deferrals.get(c.key) ?? 0;
    console.log(
      `  ${mark} ${c.urgency.toFixed(2)}  ${c.type.padEnd(17)} ${c.concept.padEnd(16)} ${c.intensity.padEnd(6)} ${c.why}` +
        (starve >= 2 ? `  (deferred ${starve}x)` : ""),
    );
    if (v) console.log(`         ^ ${v.reason}`);
  }

  console.log("ARBITRATION:");
  if (!log.chosen) {
    console.log("  nothing survived — no action. (all signals vetoed)");
  } else if ("key" in log.chosen) {
    const c = log.chosen;
    console.log(`  ${log.id}  -> ${c.type} ${c.concept} (${c.intensity})${c.item ? ` item=${c.item}` : ""}`);
    console.log(`     because: ${c.why}`);
    if (c.evidence.length) console.log(`     trigger evidence: ${c.evidence.join(", ")}`);
  } else {
    console.log(`  ${log.id}  -> BREAK: ${log.chosen.why}`);
  }
  console.log("");
}

// -------------------------------------------------------------- scenarios ---

/** each scenario returns the last arbitration so selftest can assert on it. */
const SCENARIOS: Record<string, (w: World) => ActionLog> = {
  "governor-vs-proveit": (w) => {
    console.log("# 4h sleep + a concept the learner is overconfident on.");
    console.log("# Governor says CONSOLIDATE. Calibration wants a hard adversarial task.\n");
    // build bs_lower_bound up, but claim max confidence while getting things wrong
    answer(w, "inv_which_half", true, 3);
    answer(w, "bnd_hi_len_or_len1", true, 3);
    answer(w, "lb_first_occurrence", true, 4);
    answer(w, "lb_first_occurrence", false, 4);
    answer(w, "lb_first_occurrence", false, 4);
    w.sleepHours = 4;
    w.ev("state_report", "sleep=4h");
    newSession(w);
    printState(w);
    const log = arbitrate(w);
    printDecision(w, log);
    return log;
  },

  "misconception-vs-governor": (w) => {
    console.log("# Heavy load + an active misconception actively teaching a wrong model.");
    console.log("# Does fatigue outrank a live reasoning bug, or the reverse?\n");
    answer(w, "inv_which_half", true, 3);
    answer(w, "bnd_hi_len_or_len1", true, 3);
    answer(w, "lb_first_occurrence", true, 3);
    console.log("\n> say: I find any match then scan back to the first one");
    critic(w, "I find any match then scan back to the first one");
    w.load = "heavy";
    w.ev("state_report", "load=heavy");
    newSession(w);
    printState(w);
    const log = arbitrate(w);
    printDecision(w, log);
    return log;
  },

  "deadline-vs-gap": (w) => {
    console.log("# Interview in 9d. One concept at ~0.9 but decaying, one still weak.");
    console.log("# Retention deadline vs mastery gap — which is the better use of today?\n");
    for (const [item, ok] of [
      ["inv_which_half", true],
      ["inv_terminates", true],
      ["inv_which_half", true],
      ["bnd_hi_len_or_len1", true],
      ["bnd_empty_range", true],
      ["bnd_hi_len_or_len1", true],
      ["lb_first_occurrence", true],
      ["lb_first_occurrence", true],
    ] as [string, boolean][]) {
      answer(w, item, ok, 3);
    }
    console.log("");
    advance(w, 4);
    // ub never practiced -> a real gap
    printState(w);
    const log = arbitrate(w);
    printDecision(w, log);
    return log;
  },

  starvation: (w) => {
    console.log("# Low-sleep sessions back to back. Prereqs are solid, but the only");
    console.log("# items for the weak concept are medium+, so the light ceiling vetoes");
    console.log("# it every single time. Does it EVER get touched before the interview?\n");
    // drill the prereqs to a long half-life so they stay mastered and the
    // prereq redirect stays out of the way — this isolates the ceiling veto.
    for (const it of ["inv_which_half", "inv_terminates", "inv_which_half", "bnd_hi_len_or_len1", "bnd_empty_range", "bnd_hi_len_or_len1"]) {
      answer(w, it, true, 3);
    }
    w.interviewDay = 12;
    w.sleepHours = 4;
    newSession(w);
    let log = arbitrate(w);
    for (let session = 1; session <= 5; session++) {
      console.log(`\n--- session ${session} (sleep ${w.sleepHours}h) ---`);
      log = arbitrate(w);
      printDecision(w, log);
      apply(w, log); // FINDING 3: actually execute the decision
      advance(w, 1);
      w.sleepHours = 4;
    }
    printState(w);
    return log;
  },

  "midsession-collapse": (w) => {
    console.log("# Learner opens strong then falls apart. A hard task was in the queue.\n");
    answer(w, "inv_which_half", true, 3);
    answer(w, "inv_terminates", true, 3);
    answer(w, "bnd_hi_len_or_len1", true, 3);
    console.log("  --- collapse ---");
    answer(w, "bnd_empty_range", false, 3);
    answer(w, "lb_first_occurrence", false, 4);
    answer(w, "lb_first_occurrence", false, 4);
    printState(w);
    const log = arbitrate(w);
    printDecision(w, log);
    return log;
  },

  "double-signal": (w) => {
    console.log("# Overconfidence AND a misconception on the same concept.");
    console.log("# One merged action, or two queued fighting each other?\n");
    answer(w, "inv_which_half", true, 3);
    answer(w, "bnd_hi_len_or_len1", true, 3);
    answer(w, "lb_first_occurrence", false, 4);
    answer(w, "lb_first_occurrence", false, 4);
    console.log("\n> say: I set hi = mid - 1 and that gives the first occurrence");
    critic(w, "I set hi = mid - 1 and that gives the first occurrence");
    newSession(w);
    printState(w);
    const log = arbitrate(w);
    printDecision(w, log);
    return log;
  },
};

// --------------------------------------------------------------- selftest ---

function selftest(): void {
  let failed = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!cond) failed++;
  };
  const quiet = <T>(fn: () => T): T => {
    const real = console.log;
    console.log = () => {};
    try {
      return fn();
    } finally {
      console.log = real;
    }
  };

  // 1. governor vetoes the hard prove-it task
  const a = quiet(() => {
    const w = new World();
    return { log: SCENARIOS["governor-vs-proveit"](w), w };
  });
  check(
    "governor vetoes the hard prove_it under CONSOLIDATE",
    a.log.vetoed.some((v) => v.cand.type === "prove_it") && (a.log.chosen as Candidate)?.type !== "prove_it",
    `chose ${(a.log.chosen as Candidate)?.type ?? "nothing"}`,
  );

  // 2. exempt misconception survives fatigue, downgraded
  const b = quiet(() => {
    const w = new World();
    w.flags.misconceptionExempt = true;
    return SCENARIOS["misconception-vs-governor"](w);
  });
  const bc = b.chosen as Candidate;
  check("misconceptionExempt=true -> remediate wins under fatigue", bc?.type === "remediate", `chose ${bc?.type}`);
  check("...and is downgraded to the governor ceiling", bc?.intensity === b.policy.maxIntensity, `${bc?.intensity}`);

  // 3. without the exemption it loses
  const c = quiet(() => {
    const w = new World();
    w.flags.misconceptionExempt = false;
    return SCENARIOS["misconception-vs-governor"](w);
  });
  check(
    "misconceptionExempt=false -> remediate vetoed",
    c.vetoed.some((v) => v.cand.type === "remediate"),
    `chose ${(c.chosen as Candidate)?.type ?? "nothing"}`,
  );

  // 4. starvation escalation eventually lets the starved candidate through
  const d = quiet(() => {
    const w = new World();
    w.flags.starvationEscalation = true;
    SCENARIOS["starvation"](w);
    return w;
  });
  check(
    "starvationEscalation lets a starved candidate through by session 4",
    d.actions.some((l) => (l.chosen as Candidate)?.why?.includes("escalated")),
    `${d.actions.length} decisions logged`,
  );

  // 5. no escalation -> the starved concept is never chosen
  const e = quiet(() => {
    const w = new World();
    w.flags.starvationEscalation = false;
    SCENARIOS["starvation"](w);
    return w;
  });
  check(
    "starvationEscalation=false -> starved concept never chosen",
    !e.actions.some((l) => (l.chosen as Candidate)?.why?.includes("escalated")),
  );

  // 6. prereq gate: no practice candidate for a concept whose prereqs are unmet
  const f = quiet(() => {
    const w = new World();
    return { log: arbitrate(w), w };
  });
  check(
    "no practice candidate targets a prereq-locked concept",
    f.log.considered.filter((x) => x.type === "practice").every((x) => rootBlocker(f.w, x.concept) === null),
    f.log.considered.map((x) => x.concept).join(","),
  );
  const gaps = f.log.considered.filter((x) => x.type === "practice");
  check(
    "blocked gaps redirect onto the root blocker, deduped to one candidate",
    gaps.length === 1 && gaps[0].concept === "bs_invariant" && gaps[0].why.includes("blocking"),
    `${gaps.length} gap candidate(s): ${gaps.map((g) => g.concept).join(",")}`,
  );

  // 6b. a misconception gates the prove_it on the same concept
  const h = quiet(() => {
    const w = new World();
    return SCENARIOS["double-signal"](w);
  });
  check(
    "misconception gates prove_it on the same concept",
    h.vetoed.some((v) => v.cand.type === "prove_it" && v.reason.includes("clear the misconception")) &&
      (h.chosen as Candidate)?.type === "remediate",
    `chose ${(h.chosen as Candidate)?.type}`,
  );

  // 7. break beats everything
  const g = quiet(() => {
    const w = new World();
    answer(w, "inv_terminates", true, 3);
    answer(w, "bnd_empty_range", true, 3);
    answer(w, "lb_first_occurrence", true, 3);
    return arbitrate(w);
  });
  check("3 consecutive medium+ items forces a break", (g.chosen as { type: string })?.type === "break");

  // 8. every decision names its policy and candidate set (auditability, #8)
  check(
    "every logged action carries policy + considered set",
    d.actions.every((l) => l.policy.reasons.length > 0 && Array.isArray(l.considered)),
  );

  console.log("");
  console.log(failed === 0 ? "all checks passed" : `${failed} check(s) FAILED`);
  if (failed > 0) process.exit(1);
}

// ------------------------------------------------------------------- repl ---

const HELP = `
commands
  answer <item> ok|wrong [conf 1-4]   apply BKT + calibration
  say <text>                          run the critic's misconception triggers
  day +<n>                            advance the virtual clock (applies decay)
  sleep <hours>                       governor input
  load light|heavy                    governor input
  interview <day>                     set the deadline
  next                                arbitrate and show the full trace
  do                                  arbitrate AND execute it (closes the loop)
  state                               concept table
  log                                 system action log (#8)
  events                              raw evidence log
  flags                               toggle misconceptionExempt / starvationEscalation
  scenario <name>                     run a scripted collision (fresh world)
  scenarios                           list them
  items                               list practice items
  q                                   quit
`;

function printLog(w: World): void {
  if (w.actions.length === 0) return console.log("  (empty)");
  for (const l of w.actions) {
    const c = l.chosen;
    const what = !c ? "no-action" : "key" in c ? `${c.type} ${c.concept} (${c.intensity})` : "break";
    console.log(`  ${l.id}  day ${l.day}  ${what}`);
    console.log(`     policy: ${l.policy.reasons.join(" | ")}`);
    console.log(`     considered ${l.considered.length}, vetoed ${l.vetoed.length}`);
    if (l.evidence.length) console.log(`     evidence: ${l.evidence.join(", ")}`);
  }
}

async function repl(): Promise<void> {
  let w = new World();
  console.log("THROWAWAY prototype — signal arbitration. `help` for commands.");
  printState(w);
  process.stdout.write("\n> ");

  for await (const line of console) {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    try {
      switch (cmd) {
        case "":
          break;
        case "help":
          console.log(HELP);
          break;
        case "answer": {
          const conf = rest[2] ? parseInt(rest[2], 10) : 3;
          answer(w, rest[0], rest[1] === "ok", conf);
          printState(w);
          break;
        }
        case "say":
          critic(w, rest.join(" "));
          printState(w);
          break;
        case "day":
          advance(w, Math.abs(parseInt(rest[0].replace("+", ""), 10) || 1));
          printState(w);
          break;
        case "sleep":
          w.sleepHours = parseFloat(rest[0]);
          w.ev("state_report", `sleep=${w.sleepHours}h`);
          printState(w);
          break;
        case "load":
          w.load = rest[0] === "heavy" ? "heavy" : "light";
          w.ev("state_report", `load=${w.load}`);
          printState(w);
          break;
        case "interview":
          w.interviewDay = parseInt(rest[0], 10);
          printState(w);
          break;
        case "next":
          printDecision(w, arbitrate(w));
          break;
        case "do": {
          // arbitrate AND execute — the closed loop
          const log = arbitrate(w);
          printDecision(w, log);
          apply(w, log);
          printState(w);
          break;
        }
        case "state":
          printState(w);
          break;
        case "log":
          printLog(w);
          break;
        case "events":
          for (const e of w.events) console.log(`  ${e.id}  day ${e.day}  ${e.kind}: ${e.detail}`);
          break;
        case "flags": {
          const f = rest[0];
          if (f === "exempt") w.flags.misconceptionExempt = !w.flags.misconceptionExempt;
          else if (f === "escalate") w.flags.starvationEscalation = !w.flags.starvationEscalation;
          else console.log("  flags exempt | flags escalate");
          console.log(`  misconceptionExempt=${w.flags.misconceptionExempt}  starvationEscalation=${w.flags.starvationEscalation}`);
          break;
        }
        case "items":
          for (const i of ITEMS) console.log(`  ${i.id.padEnd(20)} ${i.concept.padEnd(16)} diff ${i.difficulty} ${i.intensity}`);
          break;
        case "scenarios":
          for (const k of Object.keys(SCENARIOS)) console.log(`  ${k}`);
          break;
        case "scenario": {
          const fn = SCENARIOS[rest[0]];
          if (!fn) {
            console.log(`  no such scenario. try: ${Object.keys(SCENARIOS).join(", ")}`);
            break;
          }
          w = new World();
          console.log("");
          fn(w);
          break;
        }
        case "q":
        case "quit":
        case "exit":
          return;
        default:
          console.log(`  ? ${cmd} — try help`);
      }
    } catch (err) {
      console.log(`  ! ${(err as Error).message}`);
    }
    process.stdout.write("\n> ");
  }
}

// ------------------------------------------------------------------- main ---

const [mode, arg] = process.argv.slice(2);

if (mode === "selftest") {
  selftest();
} else if (mode === "scenario") {
  const fn = SCENARIOS[arg];
  if (!fn) {
    console.log(`no such scenario. try: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
  }
  fn(new World());
} else if (mode === "scenarios") {
  for (const k of Object.keys(SCENARIOS)) console.log(k);
} else {
  await repl();
}
