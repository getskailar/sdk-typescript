# Security Policy

## Supported versions

This SDK is pre-1.0 and under active development. Security fixes are applied to
the latest published `0.0.x` release on npm (`@skailar-ai/sdk`). Please upgrade
to the newest version before reporting an issue.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately through one of these channels:

- **GitHub Security Advisories** — preferred. Use the
  ["Report a vulnerability"](https://github.com/getskailar/sdk-typescript/security/advisories/new)
  button on the repository's Security tab.
- **Email** — `support@skailar.com` with the subject line `SECURITY: sdk-typescript`.

Please include:

- a description of the vulnerability and its impact,
- steps to reproduce (a minimal proof of concept if possible),
- the SDK version and runtime (Node/Bun/Deno/browser) affected.

## What to expect

- We aim to acknowledge a report within a few business days.
- We will keep you informed of the remediation progress and coordinate a
  disclosure timeline with you.
- Fixes are released as a new `0.0.x` version; the advisory is published once a
  fix is available.

## Scope

This policy covers the SDK code in this repository. Vulnerabilities in the
Skailar API/gateway itself should also be sent to `support@skailar.com`.
