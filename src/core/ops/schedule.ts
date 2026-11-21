export const TASK_NAME = "kyle-hub-maintain";
export const MAINTAIN_INTERVAL = "PT30M";

export interface TaskSpec {
  /** Node binary the task runs (the running node by default, so PATH is not needed at logon). */
  nodePath: string;
  /** Absolute path to the built `kh` bin (bin/kh.js). */
  khPath: string;
  /** `DOMAIN\\user` or `user` of the current account; the task runs as that user without elevation. */
  userId: string;
  /** Local ISO date-time for the first trigger boundary, e.g. `2026-11-21T09:00:00`. */
  startBoundary: string;
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Task Scheduler 1.2 XML: a 30-minute repeating time trigger and a logon trigger in one task. */
export function buildTaskXml(spec: TaskSpec): string {
  const user = escapeXml(spec.userId);
  return [
    `<?xml version="1.0" encoding="UTF-16"?>`,
    `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
    `  <RegistrationInfo><Description>kyle-hub: ingest logs, retention sweep, ticket expiry (kh maintain)</Description></RegistrationInfo>`,
    `  <Triggers>`,
    `    <TimeTrigger>`,
    `      <Repetition><Interval>${MAINTAIN_INTERVAL}</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>`,
    `      <StartBoundary>${escapeXml(spec.startBoundary)}</StartBoundary>`,
    `      <Enabled>true</Enabled>`,
    `    </TimeTrigger>`,
    `    <LogonTrigger><Enabled>true</Enabled><UserId>${user}</UserId></LogonTrigger>`,
    `  </Triggers>`,
    `  <Principals>`,
    `    <Principal id="Author"><UserId>${user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>`,
    `  </Principals>`,
    `  <Settings>`,
    `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`,
    `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>`,
    `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>`,
    `    <StartWhenAvailable>true</StartWhenAvailable>`,
    `    <AllowStartOnDemand>true</AllowStartOnDemand>`,
    `    <Enabled>true</Enabled>`,
    `    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>`,
    `  </Settings>`,
    `  <Actions Context="Author">`,
    `    <Exec><Command>${escapeXml(spec.nodePath)}</Command><Arguments>${escapeXml(`"${spec.khPath}" maintain`)}</Arguments></Exec>`,
    `  </Actions>`,
    `</Task>`,
    ``,
  ].join("\r\n");
}

export type ScheduleAction = "create" | "delete" | "query";

/** schtasks.exe argv for one action. `create` imports the XML file; no elevation is needed for a per-user task. */
export function buildSchtasksArgs(action: ScheduleAction, xmlPath?: string): string[] {
  switch (action) {
    case "create":
      if (!xmlPath) throw new Error("buildSchtasksArgs: create needs the task XML path");
      return ["/Create", "/TN", TASK_NAME, "/XML", xmlPath, "/F"];
    case "delete":
      return ["/Delete", "/TN", TASK_NAME, "/F"];
    case "query":
      return ["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"];
  }
}

/** Shell-style rendering of an argv for display; quotes arguments that contain spaces. */
export function formatCommand(argv: readonly string[]): string {
  return ["schtasks", ...argv].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}
