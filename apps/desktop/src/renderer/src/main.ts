import type { WorkspaceDisplay } from '../../preload';

/**
 * Adapted from mockup_design/index.html's inline <script> — same
 * markup, same behavior, extracted to a module so it can be loaded
 * with `script-src 'self'` (no inline script) and typed. The only
 * functional change: `workspaces` is no longer a hardcoded constant,
 * it's fetched from the main process via the secure IPC bridge
 * (window.api.listWorkspaces()) — see src/preload/index.ts and
 * src/main/ipc/handlers.ts.
 */

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Expected #${id} to exist in the DOM.`);
  }
  return el as T;
}

// ---------------------------------------------------------------
// Minimal inline icon set (lucide-style: 24x24, stroke, round caps)
// ---------------------------------------------------------------
const ICONS: Record<string, string> = {
  layers:
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  codeTwo: '<path d="m9 18-5-6 5-6"/><path d="m15 6 5 6-5 6"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
  terminal:
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3"/><line x1="12" y1="15" x2="16" y2="15"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a13 13 0 0 1 3.5 9 13 13 0 0 1-3.5 9 13 13 0 0 1-3.5-9A13 13 0 0 1 12 3z"/>',
  message: '<path d="M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  music:
    '<path d="M9 17.5V5.5l11-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/>',
  gitBranch:
    '<line x1="6" y1="3" x2="6" y2="14"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M18 8.5A7.5 7.5 0 0 1 10.5 16H8.5"/>',
  folder:
    '<path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
};

function icon(name: string, size = 16): string {
  const body = ICONS[name] ?? '';
  return `<svg class="icon" viewBox="0 0 24 24" style="font-size:${size}px">${body}</svg>`;
}

// ---------------------------------------------------------------
// Presentation constants (colors are keyed by strings from the
// workspace/tool data — real data or mock, same lookup either way)
// ---------------------------------------------------------------
const TOOL_COLORS: Record<string, { bg: string; fg: string }> = {
  blue: { bg: 'rgba(59,130,246,0.14)', fg: '#60a5fa' },
  sky: { bg: 'rgba(14,165,233,0.14)', fg: '#38bdf8' },
  zinc: { bg: 'rgba(161,161,170,0.14)', fg: '#d4d4d8' },
  orange: { bg: 'rgba(249,115,22,0.14)', fg: '#fb923c' },
  violet: { bg: 'rgba(139,92,246,0.14)', fg: '#a78bfa' },
  green: { bg: 'rgba(34,197,94,0.14)', fg: '#4ade80' },
  amber: { bg: 'rgba(245,158,11,0.14)', fg: '#fbbf24' },
};

const TAG_COLORS: Record<string, string> = {
  blue: '#60a5fa',
  violet: '#a78bfa',
  amber: '#fbbf24',
  emerald: '#34d399',
  rose: '#fb7185',
};

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let workspaces: WorkspaceDisplay[] = [];
let activeId = '';
let expandedIndex: number | null = null;

interface CreateToolPreset {
  icon: string;
  color: string;
  name: string;
  config: string;
}

const CREATE_TOOL_PRESETS: CreateToolPreset[] = [
  { icon: 'codeTwo', color: 'blue', name: 'VS Code', config: 'Project path' },
  { icon: 'box', color: 'sky', name: 'Docker', config: 'Containers / compose file' },
  { icon: 'terminal', color: 'zinc', name: 'Terminal', config: 'Commands' },
  { icon: 'globe', color: 'orange', name: 'Chrome', config: 'Profile + tabs' },
  { icon: 'message', color: 'violet', name: 'Slack', config: 'Channel' },
  { icon: 'music', color: 'green', name: 'Spotify', config: 'Playlist' },
];
const createSteps: CreateToolPreset[] = [CREATE_TOOL_PRESETS[0]!, CREATE_TOOL_PRESETS[1]!];

// ---------------------------------------------------------------
// Render sidebar
// ---------------------------------------------------------------
function renderSidebar(): void {
  const list = requireEl<HTMLDivElement>('workspace-list');
  list.innerHTML = workspaces
    .map(
      (ws) => `
      <div class="workspace-item ${ws.id === activeId ? 'active' : ''}" data-id="${ws.id}">
        <span class="workspace-tag" style="background:${TAG_COLORS[ws.tag] ?? TAG_COLORS['blue']}"></span>
        <div class="workspace-info">
          <div class="workspace-name">${ws.name}</div>
          <div class="workspace-sub">${ws.subtitle}</div>
        </div>
        <span class="workspace-kebab">${icon('more', 13)}</span>
      </div>
    `,
    )
    .join('');

  list.querySelectorAll<HTMLElement>('.workspace-item').forEach((el) => {
    el.addEventListener('click', () => {
      activeId = el.getAttribute('data-id') ?? '';
      expandedIndex = null;
      renderSidebar();
      renderDetail();
      document.querySelector('.window')?.classList.add('mobile-detail-open');
    });
  });
}

// ---------------------------------------------------------------
// Render detail
// ---------------------------------------------------------------
function renderDetail(): void {
  const ws = workspaces.find((w) => w.id === activeId);
  if (!ws) {
    return;
  }
  requireEl<HTMLElement>('crumb-current').textContent = ws.name;
  const detail = requireEl<HTMLElement>('detail');

  const stepsHtml = ws.tools
    .map((tool, i) => {
      const colors = TOOL_COLORS[tool.color] ?? TOOL_COLORS['zinc']!;
      const isLast = i === ws.tools.length - 1;
      const isOpen = expandedIndex === i;
      const expandRows = (tool.expand ?? [])
        .map(
          (row) => `
        <div class="tool-expand-row">
          ${icon(row.i, 13)}
          <span>${row.label}${row.mono ? ':' : ''}</span>
          ${row.mono ? `<code>${row.mono}</code>` : ''}
        </div>
      `,
        )
        .join('');

      return `
        <div class="timeline-row">
          <div class="timeline-rail">
            <div class="timeline-index">${i + 1}</div>
            ${isLast ? '' : '<div class="timeline-line"></div>'}
          </div>
          <div class="timeline-content">
            <div class="tool-top ${isOpen ? 'expanded' : ''}" data-step="${i}">
              <span class="tool-icon" style="background:${colors.bg}; color:${colors.fg}">${icon(tool.icon, 15)}</span>
              <span class="tool-name">${tool.name}</span>
              <span class="tool-time">${tool.time}</span>
              <span class="tool-chevron">${icon('chevronRight', 13)}</span>
            </div>
            <p class="tool-detail">${tool.detail}</p>
            <div class="tool-expand ${isOpen ? 'open' : ''}">${expandRows}</div>
          </div>
        </div>
      `;
    })
    .join('');

  detail.innerHTML = `
      <div class="detail-header">
        <div class="detail-heading">
          <button class="btn-back-mobile" id="btn-back-mobile" type="button">${icon('arrowLeft', 15)}</button>
          <div>
            <h1>${ws.name}</h1>
            <p>${ws.description}</p>
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn-icon" type="button">${icon('more', 15)}</button>
          <button class="btn-restore" type="button">
            ${icon('zap', 14)}
            Restore workspace
          </button>
        </div>
      </div>

      <div class="stats-row">
        <span class="stat-pill">${icon('check', 12)} ${ws.tools.length} tools</span>
        <span class="stat-pill">${icon('zap', 12)} ${ws.restoreTime} to restore</span>
        <span class="stat-pill">${icon('clock', 12)} Last restored ${ws.lastRestored}</span>
      </div>

      <div class="detail-sep"></div>

      <p class="section-kicker">Runs in order on restore</p>

      <div class="timeline">${stepsHtml}</div>
    `;

  detail.querySelectorAll<HTMLElement>('.tool-top').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = Number.parseInt(el.getAttribute('data-step') ?? '', 10);
      expandedIndex = expandedIndex === idx ? null : idx;
      renderDetail();
    });
  });

  const backBtn = document.getElementById('btn-back-mobile');
  backBtn?.addEventListener('click', () => {
    document.querySelector('.window')?.classList.remove('mobile-detail-open');
  });
}

// ---------------------------------------------------------------
// Create workspace modal
// ---------------------------------------------------------------
function renderCreateSteps(): void {
  const wrap = requireEl<HTMLDivElement>('create-steps');
  wrap.innerHTML = createSteps
    .map((s, i) => {
      const colors = TOOL_COLORS[s.color] ?? TOOL_COLORS['zinc']!;
      return `
        <div class="create-step">
          <span class="tool-icon" style="background:${colors.bg}; color:${colors.fg}">${icon(s.icon, 13)}</span>
          <div>
            <div class="create-step-name">${s.name}</div>
            <div class="create-step-config">${s.config}</div>
          </div>
          <span class="create-step-remove" data-remove="${i}">${icon('x', 13)}</span>
        </div>
      `;
    })
    .join('');

  wrap.querySelectorAll<HTMLElement>('[data-remove]').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = Number.parseInt(el.getAttribute('data-remove') ?? '', 10);
      createSteps.splice(idx, 1);
      renderCreateSteps();
    });
  });
}

function openCreateModal(): void {
  requireEl<HTMLElement>('create-overlay').classList.add('open');
}

function closeCreateModal(): void {
  requireEl<HTMLElement>('create-overlay').classList.remove('open');
}

requireEl<HTMLButtonElement>('btn-new-workspace').addEventListener('click', openCreateModal);
requireEl<HTMLButtonElement>('btn-close-create').addEventListener('click', closeCreateModal);
requireEl<HTMLButtonElement>('btn-cancel-create').addEventListener('click', closeCreateModal);
requireEl<HTMLElement>('create-overlay').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'create-overlay') {
    closeCreateModal();
  }
});

requireEl<HTMLButtonElement>('btn-add-tool').addEventListener('click', () => {
  const next = CREATE_TOOL_PRESETS[createSteps.length % CREATE_TOOL_PRESETS.length]!;
  createSteps.push(next);
  renderCreateSteps();
});

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
  el.innerHTML = icon(el.getAttribute('data-icon') ?? '', 14);
});

async function init(): Promise<void> {
  workspaces = await window.api.listWorkspaces();
  activeId = workspaces[0]?.id ?? '';

  renderSidebar();
  renderDetail();
  renderCreateSteps();
}

void init();
