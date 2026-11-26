/** Vertical box borders Claude (and other TUIs) draw down the sides of panels. */
const SIDE = "│┃║╎╏┆┇┊┋";
const BORDER_LINE = /^[\s─━═╌╍┄┅┈┉╭╮╰╯┌┐└┘┏┓┗┛├┤┬┴┼╔╗╚╝│┃║]+$/;
const LEAD = new RegExp(`^\s*[${SIDE}] ?`);
const TRAIL = new RegExp(`\s*[${SIDE}]\s*$`);

/**
 * Text copied from a terminal, without the screen furniture: side borders, border-only lines, trailing spaces and the
 * indent every line shares (Claude indents its replies). Text with no borders only loses trailing spaces and shared indent.
 */
export function cleanCopy(text: string): string {
  let lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const boxed = lines.some((l) => LEAD.test(l));
  if (boxed) {
    lines = lines
      .filter((l) => !(l.trim() && BORDER_LINE.test(l) && /[─━═╌╍┄┅┈┉╭╮╰╯┌┐└┘┏┓┗┛╔╗╚╝]/.test(l)))
      .map((l) => l.replace(LEAD, "").replace(TRAIL, "").replace(/\s+$/, ""));
  }
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  if (cut > 0) lines = lines.map((l) => l.slice(Math.min(cut, /^ */.exec(l)![0].length)));
  while (lines.length > 1 && !lines[0]!.trim()) lines.shift();
  while (lines.length > 1 && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.join("\n");
}
