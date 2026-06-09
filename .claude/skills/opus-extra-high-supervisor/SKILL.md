---
name: opus-extra-high-supervisor
description: Escalate a hard decision to an expert supervisor running Opus 4.8 at extra-high reasoning effort, for advice. Use when stuck after repeated attempts, facing a high-stakes or hard-to-reverse architectural/design/debugging choice, or weighing trade-offs you can't settle from evidence. The supervisor advises only — it never edits code, and you remain the decision-maker.
---

# Opus 4.8 Extra High — Expert Supervisor

An **escalation target** for hard decisions. It runs **Opus 4.8 at `xhigh` effort** (pinned
in `.claude/agents/opus-extra-high-supervisor.md`), reads the codebase to ground its advice,
and hands back judgement — it does not implement.

Its value is **capability escalation**: it is smarter-per-token than a caller running a
weaker model or lower effort. But a fresh subagent always has **less context than you** — so
it is *also* available as an independent second opinion, with the caveat that thin context
yields thin advice. It is **most worth calling when you are not already running Opus 4.8 at
max effort**; if you are, consult it only for a genuinely independent read.

## When to consult — concrete tripwires

Consult when *any* of these is true (don't wait to "feel stuck"):

- You've made **≥2 failed attempts** at the same bug or approach.
- The decision **changes a schema, public API, or data model**, or is otherwise **hard to reverse**.
- You catch yourself **guessing** rather than reasoning from evidence.
- You're about to **commit to an architecture** you can't cheaply walk back.

**Do NOT consult** for routine edits, anything you're already confident about, or a question
a quick read settles. It is slow and expensive by design — spend it where it earns its keep.

## How to consult

Dispatch with the **Agent** tool, `subagent_type: "opus-extra-high-supervisor"`. **Do not
pass a `model` override** — the agent definition pins Opus 4.8 + `xhigh`; overriding drops
the effort.

The supervisor reads code for itself, so the brief's job is to carry **what it cannot
discover** — your reasoning and the conversation context. Point it at the code; don't dump it.

- **The decision** — the one specific question.
- **Your current leaning + why** — and the worry that's stopping you committing.
- **Constraints** — non-negotiables, conventions, ADRs in play (it can't read the chat).
- **Where to look** — pointers, not contents: file:line, symbols, ADR numbers, repro steps.

**Minimum viable brief:** the specific question + your current best guess + one pointer.

```
Agent(subagent_type: "opus-extra-high-supervisor",
  description: "Advice on enqueue/worker span linking",
  prompt: "Decision: should X be A or B? I'm leaning A because <reason>; my worry is <risk>.
           Constraints: must honour CONTEXT.md term 'Y'; can't break Z. Look at: src/foo.ts:120, ADR 0004.")
```

## Consuming the advice — you stay accountable

The supervisor's reply returns to **you**, not the user. You remain the decision-maker and
**owner of the outcome**:

- **"The supervisor said so" is not a justification.** You must still defend the choice on
  its merits.
- **Calibrate deference to context dependence.** Weight its advice heavily on self-contained
  questions (an algorithm, a scoped trade-off the brief fully captured); weight your own
  judgement where the call hinges on context it never saw. If its advice contradicts
  something you know from the conversation or code, **re-consult with that context** — don't
  silently override or silently comply.
- **Relay** the recommendation and the reasoning that drove it to the user.
- The supervisor cannot edit files. **You** make the changes it recommends.

## Guarantees & caveats

There is **no runtime guarantee** the consult actually ran at Opus 4.8 / `xhigh`, and a
subagent cannot reliably self-verify its own model or effort. Specifically:

- **`CLAUDE_CODE_EFFORT_LEVEL` overrides frontmatter.** If it's set in the environment, every
  consult silently runs at that level, not `xhigh`. A deliberately reduced-effort session
  reduces your escalations too.
- **Requires Opus access.** Without it, the dispatch may fail or fall back — the advice could
  silently come from a weaker model.
- **The model pin is `claude-opus-4-8`** because `xhigh` is version-specific (Opus 4.6 lacked
  it). Re-verify the effort tier before bumping to a newer Opus.
