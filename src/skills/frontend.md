---
name: frontend
title: Frontend Engineering
description: Build accessible, component-driven, state-sane user interfaces.
applies_to: [web-app, mobile, game]
auto: domain
---

# Frontend Engineering

- **Components, not pages of spaghetti.** Small, reusable, single-purpose
  components with typed props.
- **State discipline**: keep state minimal and colocated; lift only when shared.
  Derive, don't duplicate.
- **Accessibility is not optional**: semantic HTML, labels, focus management,
  keyboard nav, sufficient contrast, `aria-*` only when semantics fall short.
- **Handle every UI state**: loading, empty, error, and success — not just the
  happy path.
- **No layout shift**; responsive by default; respect `prefers-reduced-motion`.
- Wire to the backend using the contract from `get_context("api/...")` — don't
  invent endpoints.
