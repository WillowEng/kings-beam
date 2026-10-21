# Changelog

## v2.1 — 2026-10-21

- Added `SPECIFICATION.md` from the authoritative v2.1 specification, superseding v2.0. Preserved its requirements and recorded the two owner-approved clarifications below in the relevant sections.
- Clarified category precedence: each game belongs to one exclusive eligibility category. NBA Cup regular-season games use `cup_regular`, independently of the general regular-season switch.
- Clarified verification scope: historical single-source or unverified games must not permanently block future verification. Unresolved games that could affect the current Pacific day's Beam state reduce current verification confidence.
- Added credential, local environment, secret-file, and generated-output exclusions in `.gitignore`, with exceptions for placeholder-only environment examples.
- Documentation inconsistency flagged: v2.1 references `PROJECT_HANDOFF.md` in its suggested layout and implementation instructions. The owner has directed that the planning-conversation handoff not be copied into this repository. No handoff file was added; a separate implementation handoff may be considered later. The specification's existing handoff references remain unchanged.
- Scope: local documentation setup only; no application scaffolding, commits, pushes, deployment, external configuration, or live API tests.
