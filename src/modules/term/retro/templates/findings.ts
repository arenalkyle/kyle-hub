import { evidence, sigParts, truncate } from "./diffs";
import type { Template } from "./types";

export const repeatedErrorTemplate: Template = (c) => {
  const [, tool = "tool", ...text] = sigParts(c.signature);
  return {
    type: "finding",
    title: truncate(`Repeated error in ${tool}: ${text.join(":")}`, 100),
    body: `A ${tool} call failed with the same error ${c.count}x across ${c.sessions.length} sessions. No automatic fix: decide whether it needs a rule, a script or a code change.\n\n${evidence(c)}`,
  };
};

export const outlierTemplate: Template = (c) => {
  const [, type = "task", metric = "cost"] = sigParts(c.signature);
  return {
    type: "finding",
    title: `Outlier ${metric} for ${type} tickets`,
    body: `${c.count} runs of ${type} tickets used far more ${metric} than their usual p90.\n\n${evidence(c)}`,
  };
};

export const userCorrectionTemplate: Template = (c) => {
  const [, tool = "-", ...what] = sigParts(c.signature);
  return {
    type: "finding",
    title: truncate(`Repeated correction after ${tool}: ${what.join(":")}`, 100),
    body: `You interrupted or corrected the agent after the same step ${c.count}x across ${c.sessions.length} sessions. With the draft-rule setting on, **Draft rule with Haiku** on this ticket can propose a CLAUDE.md rule.\n\n${evidence(c)}`,
  };
};
