---
name: devops
title: DevOps & Delivery
description: Make the project reproducible, runnable, and deployable.
applies_to: [api, data, cli-tool]
auto: domain
---

# DevOps & Delivery

- **Reproducible setup**: pin dependencies, commit a lockfile, document
  `install → run → test` in the README so a stranger can start in one minute.
- **One command to run** (`npm start`, `make run`, `docker compose up`) and one
  to test.
- **Config via environment**, not code. Provide `.env.example`.
- **Health & logs**: structured logging and a health endpoint for services.
- **CI-ready**: a script that installs, builds, lints, and tests in sequence so
  a pipeline can call it.
- Keep build artifacts and secrets out of version control (`.gitignore`).
