# Career-Ops (personal fork)

A personal fork of [career-ops](https://github.com/career-ops-hq/career-ops), the open-source, MIT-licensed AI job-search agent created by Santiago Fernández de Valderrama ([@santifer](https://github.com/santifer)). It runs locally inside an AI coding CLI (Claude Code and others) and keeps all job-search data on the user's own machine.

The original project's full documentation is unchanged in the [root README](../README.md).

## What career-ops does

- Scans company job boards (Greenhouse, Lever, Ashby, Workday and other providers) without LLM calls, filtered by title, location and posting age
- Evaluates a job description against the user's CV and produces a structured report and score
- Generates tailored CVs and cover letters, with a fact check against the user's own CV files so claims are not invented
- Tracks applications, follow-ups and statuses in local Markdown/TSV files
- Includes a local Next.js web dashboard (`web/`) over the same files

## What this fork adds

Changes made for my own job search, on top of upstream release 1.38.0:

- **Recruiter-site provider** (`providers/recruiter-site.mjs`): reads specialist recruiters' own job pages (WordPress REST, JobAdder widget, or plain HTML), opt-in per company in `portals.yml`
- **Rate-limit handling** (`rate-limit-state.mjs`): a 429 pauses that Workday cluster for a cool-down instead of being retried, and paused boards are reported as temporary, not broken
- **Full-sweep safeguards** (`scan-ats-full.mjs`): a time budget, per-request timeouts, progress saved when a run is stopped, per-source results (completed / partial / blocked / unavailable), and undated relevant postings kept and labelled "date unknown" instead of dropped
- **LinkedIn intake** (`linkedin-intake.mjs`): parses job links or alert emails the user pastes, never requests LinkedIn, and looks for each role on the employer's own board or SEEK before adding it
- **Dashboard additions**: an Explore page that runs several sources with per-source status, a portal-health view, scheduled scans with next-run times, per-job instructions for documents, and quality checks on generated CVs and letters (keyword coverage, unsupported claims, copied phrases)
- Tests for the above in `tests/` and `web/tests/`

## Not included

This repository contains code only. My CV, profile, tracker, reports, generated documents, contacts, scan history and settings are kept out by the project's `.gitignore` and are not here. The personal CV and cover-letter generator that some dashboard routes call (`data/cv-original/`) contains my CV data, so it is not published; those routes do nothing without it.

## Setup

See the [root README](../README.md) for requirements and onboarding. In short: Node.js 22.13+ (or 23.4+), `npm install`, then run your AI coding CLI in the repository and follow the onboarding prompts. The dashboard is in `web/` (`npm install` and `npm run dev` there).

## Licence

MIT, as in the upstream project. The original copyright notice is kept in [LICENSE](../LICENSE).
