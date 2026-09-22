import type { WorkspaceDisplay } from '../../preload';

/**
 * Placeholder data for the 'workspaces:list' / 'workspaces:restore' IPC
 * handlers, moved here verbatim from mockup_design/index.html's inline
 * `const workspaces`, with `type`/`params` added to each tool so
 * "Restore workspace" has something real to run (see
 * src/main/ipc/handlers.ts) — not just something to display.
 *
 * `vscode`, `chrome`, and `spotify` (types: 'vscode'/'chrome'/'spotify')
 * have registered tool plugins (src/main/tools/{vscode,chrome,spotify}-
 * tool.ts). `docker`, `terminal`, and `slack` are claude.md's remaining
 * approved Tier 1 step types, not built yet — restoring a workspace
 * that includes one correctly reports "no registered tool for step
 * type X" via the orchestrator, rather than pretending to succeed.
 *
 * `github` and `notes` (used by a couple of the mock entries below,
 * ported as-is from the original mockup) are NOT on that approved
 * list. They're left in only because the mockup already had them and
 * removing them would mean inventing different mock data — same
 * "no registered tool" behavior as the other unbuilt types, but do not
 * build github-tool.ts/notes-tool.ts under this list's authority; that
 * would need an explicit scope decision first (claude.md: "do not add
 * steps not on this list mid-build").
 *
 * Replacing this whole file with real persisted workspace configs
 * (read via src/main/config/loader.ts, validated against
 * @workspace-launcher/shared's WorkspaceConfigSchema, created through
 * the "New workspace" modal) is Tier 1 feature work, not boilerplate —
 * see docs/build-shell.md.
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
        type: 'vscode',
        params: { path: '~/projects/client-a' },
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
        type: 'docker',
        params: { command: 'tilt up', cwd: '~/projects/client-a' },
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
        type: 'terminal',
        params: { commands: ['npm run dev', 'npm run server'] },
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
        type: 'chrome',
        params: { profile: 'Work', urls: ['http://localhost:3000'] },
      },
      {
        icon: 'message',
        color: 'violet',
        name: 'Slack',
        time: '<1s',
        detail: 'Opens to #client-a-eng',
        expand: [{ i: 'message', label: 'Channel', mono: '#client-a-eng' }],
        type: 'slack',
        params: { channel: '#client-a-eng' },
      },
      {
        icon: 'music',
        color: 'green',
        name: 'Spotify',
        time: '<1s',
        detail: 'Resumes the Deep Focus playlist',
        expand: [{ i: 'music', label: 'Playlist', mono: 'Deep Focus' }],
        type: 'spotify',
        params: { playlist: 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ' },
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
        type: 'vscode',
        params: { path: '~/projects/side-api' },
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
        type: 'docker',
        params: { command: 'docker compose up', cwd: '~/projects/side-api' },
      },
      {
        icon: 'terminal',
        color: 'zinc',
        name: 'Terminal',
        time: '~1s',
        detail: '1 pane — npm run dev',
        expand: [{ i: 'terminal', label: 'Pane 1', mono: 'npm run dev' }],
        type: 'terminal',
        params: { commands: ['npm run dev'] },
      },
      {
        icon: 'gitBranch',
        color: 'amber',
        name: 'GitHub',
        time: '<1s',
        detail: 'Opens PR #482 in the default browser',
        expand: [{ i: 'gitBranch', label: 'Link', mono: 'PR #482' }],
        type: 'github',
        params: { url: 'https://github.com/example/side-api/pull/482' },
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
        type: 'chrome',
        params: { profile: 'Design', urls: [] },
      },
      {
        icon: 'message',
        color: 'violet',
        name: 'Slack',
        time: '<1s',
        detail: 'Opens to #design-review',
        expand: [{ i: 'message', label: 'Channel', mono: '#design-review' }],
        type: 'slack',
        params: { channel: '#design-review' },
      },
      {
        icon: 'folder',
        color: 'amber',
        name: 'Notes',
        time: '<1s',
        detail: 'Opens the review checklist',
        expand: [{ i: 'folder', label: 'Note', mono: 'Review checklist' }],
        type: 'notes',
        params: { note: 'Review checklist' },
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
        type: 'vscode',
        params: { path: '~/projects/client-b-site' },
      },
      {
        icon: 'box',
        color: 'sky',
        name: 'Docker',
        time: '~3s',
        detail: 'Starts 1 container (cms)',
        expand: [{ i: 'terminal', label: 'Command', mono: 'docker compose up cms' }],
        type: 'docker',
        params: { command: 'docker compose up cms', cwd: '~/projects/client-b-site' },
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
        type: 'terminal',
        params: { commands: ['npm run dev', 'npm run cms'] },
      },
      {
        icon: 'globe',
        color: 'orange',
        name: 'Chrome',
        time: '~1s',
        detail: 'Work profile — staging + CMS tabs',
        expand: [{ i: 'globe', label: 'Profile', mono: 'Work' }],
        type: 'chrome',
        params: { profile: 'Work', urls: [] },
      },
      {
        icon: 'music',
        color: 'green',
        name: 'Spotify',
        time: '<1s',
        detail: 'Resumes the Deep Focus playlist',
        expand: [{ i: 'music', label: 'Playlist', mono: 'Deep Focus' }],
        type: 'spotify',
        params: { playlist: 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ' },
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
        type: 'notes',
        params: { note: 'Current draft' },
      },
      {
        icon: 'music',
        color: 'green',
        name: 'Spotify',
        time: '<1s',
        detail: 'Resumes the Instrumental focus playlist',
        expand: [{ i: 'music', label: 'Playlist', mono: 'Instrumental focus' }],
        type: 'spotify',
        params: { playlist: 'spotify:playlist:37i9dQZF1DX4sWSpwq3LiO' },
      },
    ],
  },
];
