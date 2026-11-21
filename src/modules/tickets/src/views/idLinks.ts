import { findIdMatches } from "../../../../core/domain/idLinks";

/** Subtrees whose text must stay untouched: existing links, code, math and raw editors. */
const SKIP = "a, code, pre, script, style, textarea, input, .internal-link, .math";

/**
 * Replaces plain issue IDs (only those `exists` accepts) under `root` with Obsidian internal links.
 * Idempotent: links created by an earlier pass are skipped by SKIP.
 */
export function linkIssueIds(root: HTMLElement, prefix: string, exists: (id: string) => boolean): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);

  for (const node of texts) {
    const text = node.data;
    const matches = findIdMatches(text, prefix).filter((m) => exists(m.id));
    if (matches.length === 0) continue;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of matches) {
      frag.append(text.slice(last, m.index));
      const a = doc.createElement("a");
      a.className = "internal-link";
      a.setAttribute("data-href", m.id);
      a.setAttribute("href", m.id);
      a.textContent = m.id;
      frag.append(a);
      last = m.index + m.length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}
