import type { WorkspaceDisplay } from '../../preload';

/**
 * Placeholder data for the 'workspaces:list' IPC handler, moved here
 * verbatim from mockup_design/index.html's inline `const workspaces`.
 * Goal at this stage is only to prove the IPC round-trip end-to-end —
 * renderer calls window.api.listWorkspaces() instead of reading a
 * hardcoded constant, UI stays pixel-identical to the original mockup.
 *
 * Replacing this with real persisted workspace configs (read via
 * src/main/config/loader.ts, validated against
 * @workspace-launcher/shared's WorkspaceConfigSchema) is Tier 1 feature
 * work, not boilerplate — see docs/build-shell.md.
 */
export const MOCK_WORKSPACES: WorkspaceDisplay[] = [
  {
    id: 'client-a',
    name: 'Client A — Fullstack',
    tag: 'blue',
    subtitle: '6 tools · active 2h ago',
    description: 'macOS · Docker, VS Code, Chrome and 3 more, restored in order below.',
    lastRestored: '2 hours ago',
    restoreTime: '~8s',
    tools: [
      {
        icon: 'codeTwo',
        color: 'blue',
        name: 'VS Code',
        time: '~1s',
        detail: 'Opens ~/projects/client-a with the last active layout',
        expand: [
          { i: 'folder', label: 'Path', mono: '~/projects/client-a' },
          { i: 'check', label: 'Restores last active editor layout' },
        ],
      },
      {
        icon: 'box',
        color: 'sky',
        name: 'Docker',
        time: '~4s',
        detail: 'Starts 3 containers via Tilt (api, worker, postgres)',
        expand: [
          { i: 'terminal', label: 'Command', mono: 'tilt up' },
          { i: 'check', label: 'Requires Docker Desktop running' },
        ],
      },
      {
        icon: 'terminal',
        color: 'zinc',
        name: 'Terminal',
        time: '~1s',
        detail: '2 panes — npm run dev, npm run server',
        expand: [
          { i: 'terminal', label: 'Pane 1', mono: 'npm run dev' },
          { i: 'terminal', label: 'Pane 2', mono: 'npm run server' },
        ],
      },
      {
        icon: 'globe',
        color: 'orange',
        name: 'Chrome',
        time: '~1s',
        detail: 'Work profile — 4 tabs restored, localhost:3000 pinned',
        expand: [
          { i: 'globe', label: 'Profile', mono: 'Work' },
          { i: 'check', label: '4 tabs, localhost:3000 pinned' },
        ],
      },
      {
        icon: 'message',
        color: 'violet',
        name: 'Slack',
        time: '<1s',
        detail: 'Opens to #client-a-eng',
        expand: [{ i: 'message', label: 'Channel', mono: '#client-a-eng' }],
      },
      {
        icon: 'music',
        color: 'green',
        name: 'Spotify',
        time: '<1s',
        detail: 'Resumes the Deep Focus playlist',
        expand: [{ i: 'music', label: 'Playlist', mono: 'Deep Focus' }],
      },
    ],
  },
  {
    id: 'side-project',
    name: 'Side project — API',
    tag: 'violet',
    subtitle: '4 tools · last used yesterday',
    description: 'macOS · Docker, VS Code, Terminal and 1 more, restored in order below.',
    lastRestored: 'Yesterday',
    restoreTime: '~5s',
    tools: [
      {
        icon: 'codeTwo',
        color: 'blue',
        name: 'VS Code',
        time: '~1s',
        detail: 'Opens ~/projects/side-api',
        expand: [{ i: 'folder', label: 'Path', mono: '~/projects/side-api' }],
      },
      {
        icon: 'box',
        color: 'sky',
        name: 'Docker',
        time: '~3s',
        detail: 'Starts 2 containers (api, redis)',
        expand: [
          { i: 'terminal', label: 'Command', mono: 'docker compose up' },
          { i: 'check', label: 'Requires Docker Desktop running' },
        ],
      },
      {
        icon: 'terminal',
        color: 'zinc',
        name: 'Terminal',
        time: '~1s',
        detail: '1 pane — npm run dev',
        expand: [{ i: 'terminal', label: 'Pane 1', mono: 'npm run dev' }],
      },
      {
        icon: 'gitBranch',
        color: 'amber',
        name: 'GitHub',
        time: '<1s',
        detail: 'Opens PR #482 in the default browser',
        expand: [{ i: 'gitBranch', label: 'Link', mono: 'PR #482' }],
      },
    ],
  },
  {
    id: 'design-review',
    name: 'Design review',
    tag: 'amber',
    subtitle: '3 tools · last used 3d ago',
    description: 'macOS · Chrome, Slack and 1 more, restored in order below.',
    lastRestored: '3 days ago',
    restoreTime: '~4s',
    tools: [
      {
        icon: 'globe',
        color: 'orange',
        name: 'Chrome',
        time: '~2s',
        detail: 'Design profile — Figma file and review doc',
        expand: [{ i: 'globe', label: 'Profile', mono: 'Design' }],
      },
      {
        icon: 'message',
        color: 'violet',
        name: 'Slack',
        time: '<1s',
        detail: 'Opens to #design-review',
        expand: [{ i: 'message', label: 'Channel', mono: '#design-review' }],
      },
      {
        icon: 'folder',
        color: 'amber',
        name: 'Notes',
        time: '<1s',
        detail: 'Opens the review checklist',
        expand: [{ i: 'folder', label: 'Note', mono: 'Review checklist' }],
      },
    ],
  },
  {
    id: 'client-b',
    name: 'Client B — Marketing site',
    tag: 'emerald',
    subtitle: '5 tools · last used 1w ago',
    description: 'macOS · Docker, VS Code, Chrome and 2 more, restored in order below.',
    lastRestored: '1 week ago',
    restoreTime: '~7s',
    tools: [
      {
        icon: 'codeTwo',
        color: 'blue',
        name: 'VS Code',
        time: '~1s',
        detail: 'Opens ~/projects/client-b-site',
        expand: [{ i: 'folder', label: 'Path', mono: '~/projects/client-b-site' }],
      },
      {
        icon: 'box',
        color: 'sky',
        name: 'Docker',
        time: '~3s',
        detail: 'Starts 1 container (cms)',
        expand: [{ i: 'terminal', label: 'Command', mono: 'docker compose up cms' }],
      },
      {
        icon: 'terminal',
        color: 'zinc',
        name: 'Terminal',
        time: '~1s',
        detail: '2 panes — npm run dev, npm run cms',
        expand: [
          { i: 'terminal', label: 'Pane 1', mono: 'npm run dev' },
          { i: 'terminal', label: 'Pane 2', mono: 'npm run cms' },
        ],
      },
      {
        icon: 'globe',
        color: 'orange',
        name: 'Chrome',
        time: '~1s',
        detail: 'Work profile — staging + CMS tabs',
        expand: [{ i: 'globe', label: 'Profile', mono: 'Work' }],
      },
      {
        icon: 'music',
        color: 'green',
        name: 'Spotify',
        time: '<1s',
        detail: 'Resumes the Deep Focus playlist',
        expand: [{ i: 'music', label: 'Playlist', mono: 'Deep Focus' }],
      },
    ],
  },
  {
    id: 'deep-work',
    name: 'Deep work — Writing',
    tag: 'rose',
    subtitle: '2 tools · last used 2w ago',
    description: 'macOS · Notes and Spotify, restored in order below.',
    lastRestored: '2 weeks ago',
    restoreTime: '~2s',
    tools: [
      {
        icon: 'folder',
        color: 'zinc',
        name: 'Notes',
        time: '<1s',
        detail: 'Opens the current draft',
        expand: [{ i: 'folder', label: 'Note', mono: 'Current draft' }],
      },
      {
        icon: 'music',
        color: 'green',
        name: 'Spotify',
        time: '<1s',
        detail: 'Resumes the Instrumental focus playlist',
        expand: [{ i: 'music', label: 'Playlist', mono: 'Instrumental focus' }],
      },
    ],
  },
];
