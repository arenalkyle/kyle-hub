import { useEffect, useRef, useState } from "react";

const COMMIT_DELAY_MS = 250;

/** Native color swatch; commits are debounced so dragging in the picker does not write on every move. */
export function ColorInput({ value, title, onCommit }: { value: string; title: string; onCommit: (color: string) => void }) {
  const [local, setLocal] = useState(value);
  const timer = useRef<number | null>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => setLocal(value), [value]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <input
      type="color"
      className="kh-tickets-set-color"
      title={title}
      value={local}
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          commit.current(v);
        }, COMMIT_DELAY_MS);
      }}
    />
  );
}
