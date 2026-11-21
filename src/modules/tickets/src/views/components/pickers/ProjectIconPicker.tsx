import { Notice, getIconIds } from "obsidian";
import { Picker } from "../Picker";
import { ProjectGlyph } from "../icons";

const ICONS = [
  "box", "rocket", "globe", "book", "briefcase", "bug", "calendar", "camera", "cloud", "code", "cpu", "database",
  "flag", "flame", "folder", "gamepad-2", "gift", "heart", "home", "image", "key", "layers", "layout-dashboard",
  "lightbulb", "lock", "mail", "map", "megaphone", "music", "package", "palette", "pen-tool", "shield", "shopping-cart",
  "smartphone", "sparkles", "star", "target", "terminal", "trophy", "users", "wrench", "zap",
];

export interface ProjectIconPickerProps {
  anchor: HTMLElement | null;
  value: string | undefined;
  color?: string;
  onChange: (icon: string | undefined) => void;
  onClose: () => void;
}

/** Pick a lucide icon from a curated list, or type any lucide icon name or an emoji. */
export function ProjectIconPicker({ anchor, value, color, onChange, onClose }: ProjectIconPickerProps) {
  const items: (string | null)[] = [null, ...ICONS];
  return (
    <Picker<string | null>
      anchor={anchor}
      items={items}
      getKey={(i) => i ?? "__none"}
      getSearch={(i) => [i ?? "Default icon"]}
      selectedKeys={[value ?? "__none"]}
      placeholder="Pick an icon, or type an emoji or lucide name..."
      renderItem={(i) => (
        <>
          <ProjectGlyph icon={i ?? undefined} color={color} />
          <span className="kt-picker-label">{i ?? "Default icon"}</span>
        </>
      )}
      create={{
        label: (q) => `Use "${q}"`,
        onCreate: (q) => {
          const ids = getIconIds();
          if (/^[a-z0-9-]+$/i.test(q) && !ids.includes(q) && !ids.includes(`lucide-${q}`)) {
            new Notice(`"${q}" is not an icon name. Type an emoji or a lucide icon name.`);
            return;
          }
          onChange(q);
          onClose();
        },
      }}
      onSelect={(i) => onChange(i ?? undefined)}
      onClose={onClose}
    />
  );
}
