import { isShellTool, isWriteTool, normalizeCommand, normalizeSig, pathRel } from "./normalize";
import type { DerivedRecord, PriceTable, Profile } from "./types";

type Obj = Record<string, unknown>;

export interface PendingCall {
  tool: string;
  cmdNorm?: string;
  t: string;
}

/** Per-transcript parser memory, persisted in state.json so ingest can resume mid-session. */
export interface ParseState {
  pending: Record<string, PendingCall>;
  lastTool?: string;
  lastUsageMsgId?: string;
  model?: string;
}

export interface ParseCtx {
  sessionId: string;
  cwd?: string;
  profile: Profile;
  prices?: PriceTable;
  state: ParseState;
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const PERMISSION_DENIED = /permission[^.\n]{0,40}denied|requires? (?:user )?(?:approval|permission)|user (?:rejected|denied)|doesn't want to proceed/i;
const INTERRUPT = /\[?Request interrupted by user/i;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (isObj(b) ? (str(b.text) ?? (typeof b.content === "string" ? b.content : "")) : ""))
    .join("\n");
}

function usageRecord(t: string, model: string, usage: Obj, ctx: ParseCtx): DerivedRecord {
  const rec: DerivedRecord = {
    type: "usage",
    t,
    model,
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite: num(usage.cache_creation_input_tokens),
  };
  const price = ctx.prices?.[model];
  if (price) {
    const cost = (rec.inputTokens as number) * price.input + (rec.outputTokens as number) * price.output + (rec.cacheRead as number) * price.cacheRead + (rec.cacheWrite as number) * price.cacheWrite;
    rec.costUsd = Math.round(cost * 100) / 1e8; // prices are per million tokens; round to 1e-8 USD
  }
  return rec;
}

function onAssistant(o: Obj, t: string, ctx: ParseCtx): DerivedRecord[] {
  const m = isObj(o.message) ? o.message : undefined;
  if (!m) return [];
  const out: DerivedRecord[] = [];
  const model = str(m.model);
  if (model) ctx.state.model = model;
  if (isObj(m.usage) && model && m.id !== ctx.state.lastUsageMsgId) {
    ctx.state.lastUsageMsgId = str(m.id);
    out.push(usageRecord(t, model, m.usage, ctx));
  }
  const blocks = Array.isArray(m.content) ? m.content.filter(isObj) : [];
  if (!blocks.some((b) => b.type === "tool_use")) {
    if (blocks.some((b) => b.type === "text")) ctx.state.lastTool = undefined;
    return out;
  }
  for (const b of blocks) {
    if (b.type !== "tool_use") continue;
    const tool = str(b.name) ?? "unknown";
    const input = isObj(b.input) ? b.input : {};
    const id = str(b.id);
    const cmdNorm = isShellTool(tool) && str(input.command) ? normalizeCommand(str(input.command) ?? "") : undefined;
    if (id) ctx.state.pending[id] = cmdNorm !== undefined ? { tool, cmdNorm, t } : { tool, t };
    ctx.state.lastTool = tool;
    const file = str(input.file_path) ?? str(input.notebook_path);
    const rel = file ? pathRel(file, ctx.cwd) : undefined;
    if (rel && tool === "Read") out.push({ type: "file_read", t, pathRel: rel });
    else if (rel && isWriteTool(tool)) out.push({ type: "file_write", t, pathRel: rel });
  }
  return out;
}

function onUser(o: Obj, t: string, ctx: ParseCtx): DerivedRecord[] {
  if (o.isMeta === true) return [];
  const m = isObj(o.message) ? o.message : undefined;
  if (!m) return [];
  const out: DerivedRecord[] = [];
  const blocks = Array.isArray(m.content) ? m.content.filter(isObj) : [];
  const results = blocks.filter((b) => b.type === "tool_result");
  for (const r of results) {
    const id = str(r.tool_use_id);
    const p = id ? ctx.state.pending[id] : undefined;
    if (!p || !id) continue;
    delete ctx.state.pending[id];
    const ok = r.is_error !== true;
    const text = textOf(r.content);
    const rec: DerivedRecord = { type: "tool_call", t, tool: p.tool, ok };
    if (p.cmdNorm !== undefined) rec.cmdNorm = p.cmdNorm;
    const dur = Date.parse(t) - Date.parse(p.t);
    if (Number.isFinite(dur) && dur >= 0) rec.durationMs = dur;
    out.push(rec);
    if (!ok) out.push({ type: "error", t, tool: p.tool, sigText: normalizeSig(text) });
    const denied = PERMISSION_DENIED.exec(text);
    if (denied) out.push({ type: "permission_denied", t, tool: p.tool, pattern: p.cmdNorm ?? p.tool });
    if (INTERRUPT.test(text)) {
      out.push({ type: "interrupt", t, afterTool: p.tool });
      ctx.state.lastTool = undefined;
    }
  }
  const userText = typeof m.content === "string" ? m.content : blocks.filter((b) => b.type === "text").map((b) => str(b.text) ?? "").join("\n");
  if (userText.length > 0 && results.length === 0) {
    if (INTERRUPT.test(userText)) out.push({ type: "interrupt", t, afterTool: ctx.state.lastTool ?? null });
    else if (ctx.state.lastTool) {
      const rec: DerivedRecord = { type: "user_correction", t, afterTool: ctx.state.lastTool };
      if (ctx.profile !== "work") rec.excerpt = userText.slice(0, 120);
      out.push(rec);
    }
    ctx.state.lastTool = undefined;
  }
  return out;
}

type Handler = (o: Obj, t: string, ctx: ParseCtx) => DerivedRecord[];
const HANDLERS: Readonly<Record<string, Handler>> = { assistant: onAssistant, user: onUser };

/**
 * Maps one transcript line to derived records (tolerant: unknown types return undefined so the
 * caller counts them as skipped; never throws on odd shapes).
 */
export function parseTranscriptLine(line: unknown, ctx: ParseCtx): DerivedRecord[] | undefined {
  if (!isObj(line)) return undefined;
  const handler = typeof line.type === "string" ? HANDLERS[line.type] : undefined;
  if (!handler) return undefined;
  const t = str(line.timestamp);
  if (!t) return [];
  return handler(line, t, ctx);
}
