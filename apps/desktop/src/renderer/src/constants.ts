// Presentation constants, ported from mockup_design/index.html. Colors
// are keyed by strings from the workspace/tool data — real data or
// mock, same lookup either way.
export const TOOL_COLORS: Record<string, { bg: string; fg: string }> = {
  blue: { bg: 'rgba(59,130,246,0.14)', fg: '#60a5fa' },
  sky: { bg: 'rgba(14,165,233,0.14)', fg: '#38bdf8' },
  zinc: { bg: 'rgba(161,161,170,0.14)', fg: '#d4d4d8' },
  orange: { bg: 'rgba(249,115,22,0.14)', fg: '#fb923c' },
  violet: { bg: 'rgba(139,92,246,0.14)', fg: '#a78bfa' },
  green: { bg: 'rgba(34,197,94,0.14)', fg: '#4ade80' },
  amber: { bg: 'rgba(245,158,11,0.14)', fg: '#fbbf24' },
};

export const TAG_COLORS: Record<string, string> = {
  blue: '#60a5fa',
  violet: '#a78bfa',
  amber: '#fbbf24',
  emerald: '#34d399',
  rose: '#fb7185',
};

export function toolColor(color: string): { bg: string; fg: string } {
  return TOOL_COLORS[color] ?? TOOL_COLORS['zinc']!;
}

export function tagColor(tag: string): string {
  return TAG_COLORS[tag] ?? TAG_COLORS['blue']!;
}

export interface CreateToolPreset {
  icon: string;
  color: string;
  name: string;
  config: string;
}

export const CREATE_TOOL_PRESETS: CreateToolPreset[] = [
  { icon: 'codeTwo', color: 'blue', name: 'VS Code', config: 'Project path' },
  { icon: 'box', color: 'sky', name: 'Docker', config: 'Containers / compose file' },
  { icon: 'terminal', color: 'zinc', name: 'Terminal', config: 'Commands' },
  { icon: 'globe', color: 'orange', name: 'Chrome', config: 'Profile + tabs' },
  { icon: 'message', color: 'violet', name: 'Slack', config: 'Channel' },
  { icon: 'music', color: 'green', name: 'Spotify', config: 'Playlist' },
];
