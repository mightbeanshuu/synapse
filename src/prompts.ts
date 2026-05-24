export function phase1Prompt(preamble: string, brief: string): string {
  return `${preamble}

---
PROJECT BRIEF:
${brief}
---

Deliver your output now. Be concrete and complete. Stick to your role.`;
}

export function phase2Prompt(
  preamble: string,
  brief: string,
  peerName: string,
  peerOutput: string
): string {
  return `${preamble}

---
PROJECT BRIEF:
${brief}
---

${peerName} completed Phase 1 and produced this:
\`\`\`
${peerOutput}
\`\`\`

Phase 2 — your job now:
1. Identify gaps or errors in their output (from YOUR role's lens)
2. Deliver your complementary contribution that makes the project complete
3. Do NOT repeat what they already did correctly

Be terse. Only add what's missing or needs correction.`;
}
