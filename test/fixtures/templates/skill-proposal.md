---
doctype: proposal
audience: human
reviewed: 2026-11-20
---
# Skill: deploy and push after build

## Problem

Agents finish a build and stop before deploying. In four sessions this week the human had to ask for the deploy and push by hand.

## Trigger

Build, test and lint just passed in kyle-hub.

## Steps

1. Run `npm run deploy`.
2. Commit with a conventional message.
3. Run `git push`.
4. Report the deploy and the push in the reply.

## Cost saved

About one prompt and 2,000 tokens per session, roughly five sessions a week. Estimate from this week's transcripts.
