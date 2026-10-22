---
name: judge
description: Evaluate and plan a new feature before writing any code — judges UX comfort, engineering best-practice, and edge cases from multiple parallel angles, converges on the one cleanest approach (never a menu), always gets explicit approval of the idea before planning, and only stops again before building if the technical plan actually surfaces a tradeoff or open decision. Use whenever starting a new feature, a significant change, or when invoked explicitly as /judge <feature description>.
---

# /judge — feature direction & planning gate

A gate between "we have an idea" and "code gets written." Mirrors the workflow this project has already used organically for its bigger features (the tool-logo/restore-progress work, the workspace-modal redesign) — this skill makes that process repeatable instead of re-derived each time. Idea approval (Stage 1) is always an explicit stop — committing to build something at all is always worth a real yes. The technical plan (Stage 2) only stops for approval when it actually surfaces something to decide; a solid plan with no real tradeoff left in it proceeds straight into building, stated plainly, not silently.

## Core principles this skill judges every feature against

Read `CLAUDE.md` fresh at the start of every invocation for this project's current, authoritative rules (scope, platform roadmap, code-quality standard) — it changes over time and this list is not a substitute for it. These are the meta-principles that shape *how* the judging itself is done:

1. **Fail loudly, never silently.** Every failure path the feature can hit must surface clearly to the user — no silent fallbacks, no swallowed errors.
2. **Production-grade from the first commit.** No "fix it later" hacks, no dead code, no half-finished implementation left looking done.
3. **Reuse before inventing.** Check the codebase for an existing pattern/abstraction the feature should fit into before designing a new one-off shape.
4. **One correct answer, not a menu.** When multiple viable approaches exist, judge them down to the single cleanest one and say why it wins — don't hand the user an unweighted list to pick from blind.
5. **Judge UX from the user's actual seat**, not just technical correctness — would a real user (a developer restoring their own workspace, this app's actual target per claude.md) find this comfortable and low-friction? Research real prior art (how do other tools solve this) when unsure rather than guessing conventions.
6. **Think in edge cases before code, not after a bug report.** Enumerate realistic failure/edge scenarios and how each gets handled as part of judging the idea, not as an afterthought during implementation.
7. **Check security and platform scope against this project's actual rules**, not generic security theater — sandboxing, least-privilege IPC, command-injection surface, Windows-v1-first, whatever claude.md currently says.
8. **Flag gaps and shortcuts explicitly.** Never let something incomplete pass as finished without saying so, in the judgment, the plan, and the build.
9. **Watch for the founder's known failure pattern** (claude.md's own section on this): a vague, no-deadline "quick detour" proposed instead of the harder committed task gets named before proceeding, not silently indulged.
10. **A stop is for an actual decision, not a formality.** Stage 1 (committing to build a feature at all, in a given shape) always gets an explicit go — that's always a real decision. Stage 2 (the technical plan) only needs one when it surfaces a genuine tradeoff, open question, or something that changes the Stage-1-approved direction; a plan with nothing left to decide proceeds straight into Stage 3, stated plainly as you do it, not silently. Build-time commit authorization (Stage 3's own separate git gate) never gets skipped regardless.
11. **Don't ask what's already answered.** Before turning a design fork into a question for the user, check whether `CLAUDE.md`'s scope/principles or an existing doc in `WCs/` (`WC__project-status.md` — single source of truth for current build status; `WC__design-system.md`; `WC__vscode-terminal-restore.md`; any later addition to that folder) already resolves it. If one does, decide it yourself and say what you decided and why — don't make the user re-answer something the project has already settled. Only surface a question when it's genuinely open: not addressed by those docs, or a real product/taste call with more than one defensible answer (e.g. the "recent" scoping question in the folder-picker judgment was real and correctly surfaced; whether a Tier-1 backlog item's own parenthetical already includes a sub-feature, as it did there too, is not — that one should have been stated as a finding, not asked about).

## Stage 1 — Judge the idea (parallel agents, no code, no plan file yet)

Launch several agents in parallel (one message, multiple Agent calls) from distinct angles. Scale the exact set to the feature, but default to:

- **User-comfort angle** — adopt the actual target user's perspective. Is this comfortable, intuitive, low-friction? When unsure how similar tools handle this, use WebSearch for real prior art instead of guessing a convention.
- **Best-practice/engineering angle** — research how this is correctly and cleanly built (APIs, platform behavior, security implications — WebSearch/WebFetch as needed). Identify every viable approach, then converge on the *one* cleanest, with explicit reasoning for why it beats the alternatives.
- **Codebase-fit angle** (Explore) — find the existing pattern/abstraction this should reuse or match, so the recommendation doesn't invent a one-off shape.
- **Edge-case angle** — enumerate realistic failure/edge scenarios and how each should be handled.

Synthesize their findings yourself into **one** recommended idea and approach — not a menu — covering: the chosen direction, why it beat the alternatives, the main edge cases and their handling, and the UX-comfort findings. Before presenting, run every open fork through principle 11 — resolve what `CLAUDE.md`/`WCs/` already answers yourself and present it as a finding, not a question. Present the recommendation to the user, with only the genuinely open questions (if any) called out.

**Hard stop.** Do not proceed to Stage 2 without the user's explicit approval of the idea and approach.

## Stage 2 — Technical plan (only after Stage 1 is approved)

No mode switch — run this stage the normal way, same as Stage 1: launch agents directly in the current mode, never `EnterPlanMode`. Parallel Explore agents for codebase specifics → Plan agent(s) for the concrete implementation → an adversarial review pass that stress-tests the plan for real bugs/gaps before it's presented (this project's established practice — catch issues before code exists, not after). Research/Explore/Plan/review agents always run this way — launched directly, never gated behind a mode switch — for both Stage 1 and Stage 2.

Don't stop at an arbitrary cap on agent count when more angles would genuinely sharpen the result — launch additional Explore/Plan agents in parallel per distinct sub-question (e.g. data-flow, testing conventions, existing UI patterns to reuse are three separate angles for one feature, not one), then combine their findings yourself into the single plan. More agents in parallel cost no extra turnaround, so default to splitting a plan with several genuinely separable angles across several agents rather than one broad agent doing all of it serially.

Present the final, synthesized plan directly in the conversation (Context → concrete design → tests → verification) — no separate plan file to write, no mode to exit.

If anything surfaces here that needs the user's attention or would change the Stage-1-approved direction, say so explicitly rather than silently adjusting the plan around it — but first check it against principle 11 the same way: decide it yourself and state the decision if `CLAUDE.md`/`WCs/` already answers it, only actually ask if it's genuinely open.

**Conditional stop.** If the plan is solid — no real tradeoff, no open decision, nothing a reasonable default doesn't already settle — proceed straight into Stage 3 without waiting for a separate approval; say plainly that you're doing so and why the plan is uncontroversial. If it surfaces a genuine tradeoff or open decision, present it clearly and wait for the user before building.

## Stage 3 — Build (only after Stage 2 is approved)

Implement following the approved plan. Verify fully — lint, typecheck, test, build — before considering it done, matching this project's standard gate. Flag any real deviation from the plan encountered along the way rather than quietly absorbing it. Do not commit without a separate, explicit go-ahead, matching this project's established practice.

## Stage 4 — Post-build review (always run once, right after Stage 3's verification passes)

Never skipped, never optional polish — the same "catch issues before they cause real harm" instinct Stage 2's adversarial review already applies to a *plan*, now applied once to the *real code* just written. One round, covering both of these together rather than as two separate passes:

1. **Bugs** — real, concrete correctness issues in what was actually written. Not a restatement of concerns already raised and resolved during Stage 2's adversarial review.
2. **Product improvement** — reuse/simplification/efficiency opportunities, and anything that would make the shipped feature meaningfully better for the user, caught now while the context is still fresh rather than left to surface later as a complaint.

Use this project's `code-review` skill (or equivalent) against the diff, at an effort level matched to the size of what was actually built — a one-file tweak doesn't need the same depth as a multi-file feature. Fix anything clear-cut and low-risk inline; flag anything bigger, riskier, or genuinely a judgment call for the user rather than silently deciding it yourself. This is a floor, not a ceiling — if something about the specific feature calls for more (e.g. a security-sensitive surface), say so and go further, same as every other stage in this skill.
