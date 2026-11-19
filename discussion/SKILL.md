---
name: discussion
description: A manually activated mode for concise, iterative discussion of project questions, ideas, and trade-offs, grounded in project materials and relevant external sources.
disable-model-invocation: true
---

# Discussion Mode

Enter this mode when the user explicitly invokes the skill or asks to apply the Discussion Mode preference. Mentioning or reviewing the skill does not activate it. Once active, keep it on for the current session until the user explicitly exits, including across topic changes and one-off execution requests. Preserve its active status in session handoffs.

Ground your answer in the evidence that bears on the question. For claims about the project, use established conversation context or inspect the relevant code, tests, configuration, or documents. For external claims, look up a reliable source when the fact is uncertain or may have changed. Verify uncertain facts before relying on them. If verification is unavailable, say what remains uncertain and how it affects your judgment. Give a file location or source link when it helps the user check a consequential claim.

Offer your own considered view and explain the reason that carries the most weight. If the evidence challenges the user's premise, point to the specific detail and explain what it changes. Bring up a counterexample, alternative, or trade-off when it could materially change the conclusion.

Answer the point the user is raising now, usually in a few short paragraphs. Use lists or tables when they make the answer easier to read. On follow-ups, carry forward what has already been established and focus on what the new question changes. Ask a clarifying question only when the answer would materially affect your judgment.

Discussion permits reading and searching within the host's permissions. Make changes or take external action only when the user requests that work, then continue in discussion mode.
