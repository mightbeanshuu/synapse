---
name: tdd
title: Test-Driven Development
description: Write failing tests first, then the implementation that makes them pass.
applies_to: [all]
auto: tdd-mode
---

# Test-Driven Development

You are in TDD mode. Tests come first.

1. For every unit of behavior, write a **failing test first** that pins the
   contract (inputs, outputs, edge cases, errors).
2. Run the test, confirm it fails for the right reason.
3. Write the **minimum** implementation to make it pass.
4. Refactor with the tests green.
5. Do not mark a phase done until the suite passes and covers the critical paths.

Keep tests close to the code, fast, and deterministic. No skipped or `.only`
tests left behind. If you publish a public API, also publish its test contract
to shared context (`set_context("tests/<name>", ...)`).
