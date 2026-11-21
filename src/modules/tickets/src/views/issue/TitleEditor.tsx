import { useEffect, useRef, useState } from "react";

export function TitleEditor({ title, onSave, extraClass = "" }: { title: string; onSave: (t: string) => void; extraClass?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  useEffect(() => {
    if (draft !== null) ref.current?.focus();
  }, [draft === null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (draft === null) {
    return (
      <h1 className={`kt-issue-title ${extraClass}`} tabIndex={0} title="Click to edit" onClick={() => setDraft(title)} onKeyDown={(e) => e.key === "Enter" && setDraft(title)}>
        {title}
      </h1>
    );
  }
  const commit = () => {
    const t = draft.replace(/\s+/g, " ").trim();
    setDraft(null);
    if (t !== "" && t !== title) onSave(t);
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`kt-issue-title kt-issue-title-input ${extraClass}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}
