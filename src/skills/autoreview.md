---
name: autoreview
title: Structured Code Audit
description: Audit the whole codebase and grade findings Critical / Warning / Info.
applies_to: [all]
auto: review-mode
---

# Structured Code Audit

You are auditing the finished project. Read **every** file, then build the
verification first, then report.

1. Run the build / type-check (`npx tsc --noEmit`, compiler, linter) and the
   test suite. Record what passes and what fails.
2. Walk the codebase looking for: missing files referenced but not created,
   broken imports, security holes (see security-audit), missing tests, missing
   docs, dead code, and TODO/stub leftovers.
3. Write **REVIEW.md** in the project root with findings grouped and graded:
   - `## Critical` — broken build, security holes, data loss, won't run
   - `## Warning` — bugs, missing tests, fragile code
   - `## Info` — style, docs, nice-to-haves
   Each finding: file:line, what's wrong, and the fix.
4. Fix the **Critical** findings yourself; leave Warning/Info documented.

Be specific and honest. An empty section is fine if there's nothing to report.
