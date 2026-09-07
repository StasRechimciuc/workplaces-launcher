/**
 * Maps a tool/tag `color` key (a string on workspace/tool data, e.g.
 * "blue", "violet") to a complete, static Tailwind class string.
 * Tailwind can only generate CSS for a class name it can see literally
 * in source — it can't resolve a runtime template like
 * `bg-tool-${color}` — so every possible combination is enumerated
 * here instead of built dynamically. See styles.css's @theme for the
 * actual color values these classes resolve to.
 */

const TOOL_BADGE_CLASSES: Record<string, string> = {
  blue: 'bg-tool-blue-soft text-tool-blue',
  sky: 'bg-tool-sky-soft text-tool-sky',
  zinc: 'bg-tool-zinc-soft text-tool-zinc',
  orange: 'bg-tool-orange-soft text-tool-orange',
  violet: 'bg-tool-violet-soft text-tool-violet',
  green: 'bg-tool-green-soft text-tool-green',
  amber: 'bg-tool-amber-soft text-tool-amber',
};

const TAG_DOT_CLASSES: Record<string, string> = {
  blue: 'bg-tool-blue',
  violet: 'bg-tool-violet',
  amber: 'bg-tool-amber',
  emerald: 'bg-tag-emerald',
  rose: 'bg-tag-rose',
};

/** Background + text color classes for a tool badge (the icon chip in
 * a timeline step, or a "new workspace" tool row). */
export function toolBadgeClasses(color: string): string {
  return TOOL_BADGE_CLASSES[color] ?? TOOL_BADGE_CLASSES['zinc']!;
}

/** Background color class for a workspace sidebar tag dot. */
export function tagDotClasses(color: string): string {
  return TAG_DOT_CLASSES[color] ?? TAG_DOT_CLASSES['blue']!;
}
