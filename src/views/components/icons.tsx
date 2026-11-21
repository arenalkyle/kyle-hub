import { useEffect, useRef } from "react";
import { setIcon } from "obsidian";
import type { Priority, StatusCategory } from "../../core/types";

interface StatusIconProps {
  category: StatusCategory;
  color?: string;
  size?: number;
}

export function StatusIcon({ category, color = "currentColor", size = 14 }: StatusIconProps) {
  const common = { width: size, height: size, viewBox: "0 0 14 14", fill: "none", className: "kt-icon kt-status-icon" };
  switch (category) {
    case "triage":
    case "backlog":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" strokeDasharray="1.4 1.74" />
        </svg>
      );
    case "unstarted":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" />
        </svg>
      );
    case "started":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" />
          <path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill={color} />
        </svg>
      );
    case "completed":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="7" fill={color} />
          <path d="M4 7.2 6.1 9.2 10 5" stroke="var(--background-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "canceled":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="7" fill={color} />
          <path d="M4.8 4.8 9.2 9.2M9.2 4.8 4.8 9.2" stroke="var(--background-primary)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

const BARS: Record<Priority, number> = { none: 0, low: 1, medium: 2, high: 3, urgent: 0 };

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 14 14", className: "kt-icon kt-priority-icon" };
  if (priority === "urgent") {
    return (
      <svg {...common}>
        <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="var(--color-orange)" />
        <rect x="6.3" y="3" width="1.4" height="5" rx="0.7" fill="var(--background-primary)" />
        <circle cx="7" cy="10.4" r="0.9" fill="var(--background-primary)" />
      </svg>
    );
  }
  if (priority === "none") {
    return (
      <svg {...common}>
        {[1.5, 5.5, 9.5].map((x) => (
          <rect key={x} x={x} y="6.4" width="3" height="1.2" rx="0.6" fill="var(--text-faint)" />
        ))}
      </svg>
    );
  }
  const n = BARS[priority];
  return (
    <svg {...common}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 4}
          y={9 - i * 3}
          width="3"
          height={3 + i * 3}
          rx="0.8"
          fill={i < n ? "var(--text-normal)" : "var(--text-faint)"}
          opacity={i < n ? 1 : 0.5}
        />
      ))}
    </svg>
  );
}

/** Obsidian (lucide) icon by name. */
export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span ref={ref} className="kt-icon kt-lucide" style={{ width: size, height: size }} />;
}

export function Dot({ color }: { color: string }) {
  return <span className="kt-dot" style={{ background: color }} />;
}
