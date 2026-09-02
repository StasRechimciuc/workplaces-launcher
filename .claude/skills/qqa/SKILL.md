---
name: qqa
description: Quick Question Answer mode — answer the user's rapid-fire follow-up questions as briefly as possible (one word or less when possible) to establish facts fast. Use when the user invokes /qqa.
---

# QQA — Quick Question Answer mode

The user is about to ask a series of quick questions to establish facts.

Rules while this mode is active:

- Answer in as few words as possible. One word is ideal. A short phrase only if one word truly can't convey the answer.
- No explanations, no caveats, no follow-up questions, no pleasantries — just the answer.
- If genuinely uncertain, say so in as few words as possible (e.g. "unsure" / "not confirmed") rather than hedging at length.
- Still verify before answering (check code/files/state as needed) — brevity applies to the *output*, not to skipping verification.
- Stay in this mode for every message until the user says "quit" or "exit qqa" (or an obvious equivalent), then resume normal response length.
