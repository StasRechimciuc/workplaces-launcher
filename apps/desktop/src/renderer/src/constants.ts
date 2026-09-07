// Presentation data, ported from mockup_design/index.html. Color
// lookups live in lib/tool-colors.ts (as Tailwind class names, backed
// by styles.css's @theme) — this file is just the non-color data.
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
