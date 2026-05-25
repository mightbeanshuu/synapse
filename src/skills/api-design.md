---
name: api-design
title: API Design
description: Design consistent, versioned, well-typed APIs with clear contracts.
applies_to: [api, web-app]
auto: domain
---

# API Design

- **Publish the contract first.** Define routes, request/response shapes, and
  status codes, then `set_context("api/<resource>", {...})` so partners can wire
  against it without guessing.
- **Be consistent**: plural nouns for collections, proper verbs/methods, and a
  uniform error envelope (`{ error: { code, message } }`).
- **Type everything** end to end — request bodies, responses, params. Validate
  at the edge and return 4xx with a useful message on bad input.
- **Version** from day one (`/v1/...`) so changes don't break clients.
- **Status codes mean things**: 200/201/204, 400/401/403/404/409, 422, 5xx.
- Paginate list endpoints; never return unbounded result sets.
- Document each endpoint inline and in a short API.md.
