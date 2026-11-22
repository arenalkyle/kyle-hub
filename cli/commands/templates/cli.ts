import { parseArgs } from "node:util";
import { hasVaultTemplate, readTemplate, TEMPLATE_IDS, type TemplateId } from "../../../src/core/templates";
import { EXIT, KtError, type Io } from "../tickets/cli";
import { readLogConfig } from "../logs/cli";

const USAGE = "kh templates <list | show <id>> [--vault <path>]";

const isTemplateId = (s: string): s is TemplateId => (TEMPLATE_IDS as readonly string[]).includes(s);

/** `kh templates list|show <id> [--vault <path>]`: vault override or shipped default, same vault resolution as `kh gaps`. */
export function runTemplates(argv: string[], io: Io): number {
  const [sub, ...rest] = argv;
  let vault: string | undefined;
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: rest, options: { vault: { type: "string" } }, strict: true, allowPositionals: true });
    vault = parsed.values.vault;
    positionals = parsed.positionals;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${USAGE}`);
  }
  const configured = vault !== undefined ? [vault] : readLogConfig(io.env).vaults;

  if (sub === "list" && positionals.length === 0) {
    if (configured.length === 0) throw new KtError(EXIT.usage, "No vault configured (KYLE_HUB_VAULTS / KYLE_TICKETS_VAULTS).");
    for (const v of configured) {
      if (configured.length > 1) io.out(`== ${v}`);
      for (const id of TEMPLATE_IDS) io.out(`${id}  ${hasVaultTemplate(v, id) ? "vault" : "default"}`);
    }
    return EXIT.ok;
  }
  if (sub === "show" && positionals.length === 1 && isTemplateId(positionals[0]!)) {
    // Without any vault the shipped default is still shown.
    io.out(readTemplate(configured[0], positionals[0]).replace(/\n$/, ""));
    return EXIT.ok;
  }
  const ids = TEMPLATE_IDS.join(", ");
  throw new KtError(EXIT.usage, `Usage: ${USAGE}. Ids: ${ids}`);
}
