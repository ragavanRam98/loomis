// The Brain seam - the socket the agent plugs into. The studio stops hardcoding decisions and
// instead sends INTENTS ("make it calmer") to a StudioBrain, which INTERPRETS them into concrete
// engine actions + reasoning the portal shows. Two implementations of the same seam:
//   • MechanicalBrain - a dependency-free heuristic (the default; works standalone).
//   • BridgeBrain     - posts the intent to a file bus and waits for an external agent (a Claude
//                       Agent SDK worker, or the live chat-agent) to answer. This is how "the agent
//                       is the brain behind the portal" works without embedding a model.

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Intent {
  kind: 'change';
  screenId: string;
  /** Natural language from the developer - "make it calmer", "this feels cramped". */
  text: string;
}

export interface BrainAction {
  verb: 'refine' | 'suggest' | 'regenerate' | 'add';
  screenId: string;
  feedback?: string; // for refine + add (the instruction)
  count?: number; // for suggest
}

export interface BrainDecision {
  /** The agent's thinking, shown in the portal - not just a spinner. */
  reasoning: string;
  actions: BrainAction[];
}

export interface BrainContext {
  surface?: string;
  /** Edits already applied to this screen, so the brain can avoid repeating itself. */
  refinements: string[];
}

export interface StudioBrain {
  readonly name: string;
  decide(intent: Intent, ctx: BrainContext): Promise<BrainDecision>;
}

/** Default brain: a transparent heuristic. No model - it just maps phrasing to a verb. */
export class MechanicalBrain implements StudioBrain {
  readonly name = 'mechanical';

  async decide(intent: Intent, ctx: BrainContext): Promise<BrainDecision> {
    const t = intent.text.trim();
    const label = ctx.surface ?? intent.screenId;
    if (!t) return { reasoning: 'No change requested.', actions: [] };

    // ADD a new screen (additive) - a CREATE request, not an edit. Requires a screen/page noun AND
    // an additive cue ("new", "another", "one more"…), so "make the profile screen lighter" stays a
    // refine. This is checked FIRST so a create request can never be silently turned into a replace.
    if (/\b(screens?|pages?|views?)\b/i.test(t) && /\b(new|another|one more|additional|second|extra|separate|add an?)\b/i.test(t)) {
      return {
        reasoning: `This reads as a NEW screen, not an edit - adding one based on ${label}. Your ${label} stays as-is.`,
        actions: [{ verb: 'add', screenId: intent.screenId, feedback: t }],
      };
    }
    // VARIANTS (non-destructive options to choose from).
    if (/\b(options?|variants?|alternatives?|explore|choices?|a few takes?|different versions?)\b/i.test(t)) {
      return {
        reasoning: `Exploring a few alternative designs for ${label} - pick the one you like.`,
        actions: [{ verb: 'suggest', screenId: intent.screenId, count: 3 }],
      };
    }
    // RE-ROLL from the same spec.
    if (/\b(re-?roll|redo|regenerate|try again|start over)\b/i.test(t)) {
      return {
        reasoning: `Re-rolling ${label} from the same spec for a fresh take.`,
        actions: [{ verb: 'regenerate', screenId: intent.screenId }],
      };
    }
    // Default: a directed edit IN PLACE.
    return {
      reasoning: `Applying a directed edit to ${label}: “${t}”.`,
      actions: [{ verb: 'refine', screenId: intent.screenId, feedback: t }],
    };
  }
}

export const BRAIN_INBOX = 'brain-inbox.jsonl';
export const BRAIN_OUTBOX = 'brain-outbox.jsonl';

interface InboxEntry {
  id: string;
  intent: Intent;
  ctx: BrainContext;
}

/** Read a decision the external agent wrote for a given intent id, if present. */
function readDecision(runFolder: string, id: string): BrainDecision | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(runFolder, BRAIN_OUTBOX), 'utf8');
  } catch {
    return undefined;
  }
  for (const line of raw.trim().split('\n').reverse()) {
    try {
      const obj = JSON.parse(line) as { id?: string; decision?: BrainDecision };
      if (obj.id === id && obj.decision) return obj.decision;
    } catch {
      /* skip partial line */
    }
  }
  return undefined;
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

/**
 * Bridge brain: write the intent to `brain-inbox.jsonl` and wait for an external agent to append a
 * matching `{ id, decision }` to `brain-outbox.jsonl`. If nobody answers within the timeout, fall
 * back to the mechanical brain so the portal never hangs. This is the seam a real Claude agent fills.
 */
export class BridgeBrain implements StudioBrain {
  readonly name = 'agent';

  constructor(
    private readonly runFolder: string,
    private readonly nowMs: () => number,
    private readonly fallback: StudioBrain = new MechanicalBrain(),
    private readonly timeoutMs = 180000,
  ) {}

  async decide(intent: Intent, ctx: BrainContext): Promise<BrainDecision> {
    const id = `${intent.screenId}-${this.nowMs()}`;
    const entry: InboxEntry = { id, intent, ctx };
    appendFileSync(join(this.runFolder, BRAIN_INBOX), JSON.stringify(entry) + '\n', 'utf8');

    const start = this.nowMs();
    for (;;) {
      const decision = readDecision(this.runFolder, id);
      if (decision) return decision;
      if (this.nowMs() - start >= this.timeoutMs) {
        const fb = await this.fallback.decide(intent, ctx);
        return { reasoning: `(no agent answered in time - applied your words directly) ${fb.reasoning}`, actions: fb.actions };
      }
      await sleep(1000);
    }
  }
}
