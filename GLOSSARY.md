# kyle-hub

An Obsidian plugin that serves as the hub for agentic coding work: tickets are triaged by a human, worked by agents in terminal sessions, and reviewed by a retro that feeds improvements back as new tickets.

## Modules

**Module**:
A toggleable part of kyle-hub (core, tickets, term, brain, command-center) that depends only on core.
_Avoid_: plugin, feature, package

**Core**:
The always-on module that owns shared services, the event bus, settings, redaction and log storage.
_Avoid_: shared, common, utils

**Service**:
A typed interface a module publishes through core so other modules can use it without importing it.
_Avoid_: API, manager

## Tickets

**Ticket**:
One Markdown file describing a unit of work, identified by an ID like `TIX-12`.
_Avoid_: issue, task (as a noun for the file), card

**Ticket type**:
The kind of ticket: task, bug, plan, proposal, question or finding.
_Avoid_: kind, category

**Triage**:
The status a ticket created by an agent starts in, awaiting a human decision.
_Avoid_: inbox, pending, new

**Accept / Decline**:
The human decision that moves a triage ticket into the backlog, or cancels it with a reason.
_Avoid_: approve, reject

**Agent-ready**:
The reserved label a human puts on an accepted ticket to allow agents to work it.
_Avoid_: ready, approved, queued

**Queue**:
The tickets that are agent-ready, unstarted and not blocked, in launch order.
_Avoid_: backlog, worklist

**Acceptance criteria**:
The checklist in a ticket that must be fully ticked before the ticket can be done.
_Avoid_: AC, definition of done, requirements

**Fingerprint**:
A stable key derived from a ticket's type, repo and normalized title, used to detect duplicates.
_Avoid_: hash, dedupe key

**Plan**:
A ticket of type plan whose sub-tickets are the sub-phases of a piece of work.
_Avoid_: epic, roadmap

**Phase / sub-phase**:
A step of a plan; each phase splits into two sub-phases, each sized for one agent run.
_Avoid_: milestone, stage, sprint

## Sessions and logs

**Session**:
One terminal running an agent (or a shell) inside kyle-hub.
_Avoid_: terminal, tab, window

**Run**:
One agent session launched from a ticket, identified by a run id.
_Avoid_: job, execution, attempt

**Launch**:
Starting a run from the queue: worktree, context pack, agent process, status change.
_Avoid_: start, kick off, dispatch

**Worktree**:
The per-ticket git working copy a run happens in.
_Avoid_: checkout, branch folder

**Context pack**:
The file assembled for a run that gives the agent the ticket and the docs it needs.
_Avoid_: prompt, context, briefing

**Derived record**:
A compact, redacted fact extracted from a transcript or hook event (tool call, error, denial, cost).
_Avoid_: log line, event, trace

**Run index**:
The one-line-per-run summary of every run.
_Avoid_: database, catalog

**Needs-attention**:
The state of a run that is waiting on a permission prompt or has stalled mid-turn.
_Avoid_: blocked, stuck, alert

**Profile**:
Whether a repo, vault and its logs belong to work or home.
_Avoid_: environment, workspace, context

**Redaction**:
Replacing secrets and denylisted values with placeholders before anything is stored.
_Avoid_: scrubbing (reserved for promotion), masking, sanitizing

## Retro

**Retro**:
The review of runs since the last retro that turns recurring patterns into tickets.
_Avoid_: retrospective analysis, review, audit

**Retro watermark**:
The time of the last retro; a retro reads only runs after it.
_Avoid_: cursor, checkpoint, last run

**Signal**:
One observed occurrence of a pattern in a run (a denial, a repeated error, a command sequence).
_Avoid_: event, hit

**Signature**:
The normalized form of a signal that lets occurrences across runs be counted together.
_Avoid_: pattern id, hash

**Cluster**:
A signature that has met the occurrence threshold in a retro.
_Avoid_: pattern, group

**Proposal**:
A ticket containing a concrete diff to a script, skill, setting or rule, generated from a cluster.
_Avoid_: suggestion, recommendation, improvement

**Finding**:
A ticket that reports a cluster with evidence but carries no diff.
_Avoid_: observation, insight

**Apply**:
Writing an accepted proposal's diff to its target.
_Avoid_: merge, install, implement

**Recurrence**:
A signature from an applied proposal appearing again after the apply date.
_Avoid_: regression, relapse

## Brain

**Brain**:
The module that holds the docs system and assembles context packs.
_Avoid_: knowledge base, wiki, memory

**Doc type**:
The kind of doc: adr, glossary, plan, status, runbook, lesson, overview, ticket, reminder or proposal. A ticket doc is a vault copy of a ticket (no review deadline), a reminder is a short-lived to-do note (review within 7 days) and a proposal is a skill or script idea awaiting a decision (review within 30 days).
_Avoid_: template, category

**Lesson**:
A cross-project piece of learned guidance kept in the vault.
_Avoid_: tip, note, learning

**Stale doc**:
A doc flagged by a staleness check (past review date, dead references, out of date status).
_Avoid_: outdated, old

**Brain health**:
The score summarizing how many docs are stale or invalid.
_Avoid_: doc score, coverage

**Promote**:
Copying a work lesson or proposal to the home vault after scrubbing and human review.
_Avoid_: share, export, sync
