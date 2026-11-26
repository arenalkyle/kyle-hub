import { describe, expect, it } from "vitest";
import { planPromote, promoteEligible, scrubOptionsFrom } from "./promote";
import { scrub } from "./scrub";

const opts = { repoNames: ["acme-api", "kyle-hub"], denylist: ["Project Falcon", "acmecorp"] };
const s = (t: string, o = opts): string => scrub(t, o).text;

describe("scrubber corpus", () => {
  it("emails: replaced / not an email", () => {
    expect(s("ping kyle.a@acmecorp.com today")).toBe("ping <email> today");
    expect(s("use the @types/node package and a@b")).toBe("use the @types/node package and a@b");
  });

  it("urls: non-public replaced / public host kept", () => {
    expect(s("see https://wiki.corp.local/runbooks/x.")).toBe("see <url>.");
    expect(s("see https://github.com/foo/bar/issues/1 and https://docs.anthropic.com/en/x")).toBe(
      "see https://github.com/foo/bar/issues/1 and https://docs.anthropic.com/en/x",
    );
    expect(s("see https://evilgithub.com/x")).toBe("see <url>");
  });

  it("paths: absolute replaced / relative kept", () => {
    expect(s("edit C:\\Work\\acme\\src\\a.ts now")).toBe("edit <path> now");
    expect(s("edit D:/code/x/y.ts, then")).toBe("edit <path>, then");
    expect(s("at /home/kyle/proj/file.ts")).toBe("at <path>");
    expect(s("share \\\\fileserver\\team\\docs")).toBe("share <path>");
    expect(s("edit src/core/a.ts and ./b.ts")).toBe("edit src/core/a.ts and ./b.ts");
    expect(s("a 1/2 split and and/or")).toBe("a 1/2 split and and/or");
  });

  it("hosts: private replaced / public and file names kept", () => {
    expect(s("db at build01.corp.local and 10.0.3.7")).toBe("db at <host> and <host>");
    expect(s("docs on github.com and developer.mozilla.org")).toBe("docs on github.com and developer.mozilla.org");
    expect(s("open index.ts and README.md and v1.2.3")).toBe("open index.ts and README.md and v1.2.3");
  });

  it("repo names: replaced as whole tokens / substrings kept", () => {
    expect(s("the acme-api repo and Kyle-Hub")).toBe("the <repo> repo and <repo>");
    expect(s("acme-api-gateway and myacme-api")).toBe("acme-api-gateway and myacme-api");
  });

  it("denylist: replaced (case-insensitive) / other words kept", () => {
    expect(s("Project Falcon belongs to AcmeCorp")).toBe("<term> belongs to <term>");
    expect(s("a falcon and acmecorporation")).toBe("a falcon and acmecorporation");
  });

  it("custom public hosts and counts", () => {
    const r = scrub("https://internal.example.org/a mail x@y.io C:\\a\\b", { publicHosts: ["example.org"] });
    expect(r.text).toBe("https://internal.example.org/a mail <email> <path>");
    expect(r.counts).toEqual({ email: 1, path: 1 });
  });

  it("is deterministic and idempotent", () => {
    const t = "C:\\x\\y acme-api https://a.corp.local/z x@y.io 10.1.1.1";
    expect(s(s(t))).toBe(s(t));
  });
});

describe("promote", () => {
  const lesson = "---\ntype: lesson\n---\nSee C:\\Work\\acme-api\\a.ts in acme-api.\n";
  it("eligibility", () => {
    expect(promoteEligible(lesson).ok).toBe(true);
    expect(promoteEligible("---\ntype: proposal\ntags: [applied]\n---\nx").ok).toBe(true);
    expect(promoteEligible("---\ntype: proposal\ntags: []\n---\nx").ok).toBe(false);
    expect(promoteEligible("---\ntype: adr\n---\nx").ok).toBe(false);
    expect(promoteEligible("no frontmatter").ok).toBe(false);
  });

  it("plans a scrubbed lesson under Brain/lessons with a diff", () => {
    const p = planPromote("My Lesson.md", lesson, opts);
    expect(p.targetRel).toBe("Brain/lessons/My Lesson.md");
    expect(p.after).toContain("See <path> in <repo>.");
    expect(p.diff).toContain("-See C:\\Work");
    expect(p.diff).toContain("+See <path> in <repo>.");
    expect(p.changed).toBe(true);
  });
  it("plans the lesson under the home vault's brain folder when set", () => {
    const p = planPromote("My Lesson.md", lesson, opts, "docs");
    expect(p.targetRel).toBe("docs/lessons/My Lesson.md");
    expect(p.diff).toContain("+++ home/docs/lessons/My Lesson.md");
  });

  it("seeds the denylist with repo keys and GitHub orgs", () => {
    const o = scrubOptionsFrom({ denylist: ["x"] }, { api: { github: "AcmeOrg/api" }, web: {} });
    expect(o.repoNames).toEqual(["api", "web"]);
    expect(o.denylist).toEqual(["x", "AcmeOrg"]);
    expect(o.publicHosts).toContain("github.com");
  });
});
