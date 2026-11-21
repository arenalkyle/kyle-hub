import { useRef, useState } from "react";
import { Markdown } from "../components/Markdown";
import { MarkdownEditor } from "./MarkdownEditor";

export interface DescriptionProps {
  description: string;
  sourcePath: string;
  onSave: (md: string) => void;
}

export function Description({ description, sourcePath, onSave }: DescriptionProps) {
  const [editing, setEditing] = useState(false);
  const done = useRef(false);

  const begin = () => {
    done.current = false;
    setEditing(true);
  };
  const finish = (md: string) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (md.trim() !== description.trim()) onSave(md);
  };

  if (editing) {
    return (
      <MarkdownEditor
        className="kh-tickets-desc-editor"
        value={description}
        autoFocus
        placeholder="Add description…"
        onBlur={finish}
        onCancel={finish}
        onSubmit={finish}
      />
    );
  }
  return (
    <div
      className="kh-tickets-desc"
      tabIndex={0}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("a, input, button, summary")) begin();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) begin();
      }}
    >
      {description.trim() === "" ? (
        <div className="kh-tickets-desc-empty">Add description…</div>
      ) : (
        <Markdown md={description} sourcePath={sourcePath} />
      )}
    </div>
  );
}
