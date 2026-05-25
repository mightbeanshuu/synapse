---
name: security-audit
title: Security Hardening
description: Build with security defaults; avoid the common injection/secret/auth holes.
applies_to: [api, web-app, data]
auto: domain
---

# Security Hardening

Bake these in as you build — do not bolt them on later:

- **No hardcoded secrets.** Read keys/tokens/passwords from env (`.env`,
  never committed). Add `.env.example` with placeholder names only.
- **Parameterize every query.** No string-concatenated SQL/NoSQL. Use the
  driver's prepared statements / query builder.
- **Validate and sanitize all input** at the boundary (body, query, params,
  headers). Reject by all-list, not deny-list.
- **AuthN/AuthZ on every protected route.** Check the session/token AND that
  the caller owns the resource.
- **Lock down CORS** to known origins; never `*` with credentials.
- **Escape output** to prevent XSS; set security headers (CSP, HSTS,
  X-Content-Type-Options).
- **Hash passwords** with bcrypt/argon2; never store or log them.

Flag anything you cannot fully fix in your phase summary.
