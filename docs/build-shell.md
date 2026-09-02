# Workspace Launcher — Build Shell

## Tier 1 — v1 (build now)

### Core
- [ ] Define workspace config format (JSON)
- [ ] Config holds ordered list of steps
- [ ] Each step: tool type + params
- [ ] macOS app reads config, runs steps in order
- [ ] Simple UI: workspace list + detail (already mocked)

### Step types to support
- [ ] VS Code — open folder path
- [ ] Terminal — open pane(s), run command(s)
- [ ] Docker — run compose/tilt command
- [ ] Chrome — open profile + URLs
- [ ] Spotify — open playlist URI
- [ ] Slack — open channel deep link

### VS Code companion extension
- [ ] Scaffold extension (yo code)
- [ ] Extension reads config on activation
- [ ] Create terminal(s) via `createTerminal()`
- [ ] Run commands via `terminal.sendText()`
- [ ] Position terminals (editor vs panel)

### Orchestrator logic
- [ ] Shell out for CLI tools (Docker, git)
- [ ] `open -a` / AppleScript for GUI apps
- [ ] Sequence steps (wait where needed)
- [ ] Show per-step status (success/fail)
- [ ] Basic retry button per failed step

### Explicitly NOT in v1
- No teardown of previous workspace
- No conflict/port detection
- No k8s context switching
- No parallel workspace support
- No AI-driven decisions — rules only

## Tier 2 — v2 (after v1 validated)

### State tracking
- [ ] Track what's currently running
- [ ] Track active k8s context
- [ ] Track occupied ports

### Teardown
- [ ] Stop containers on switch (`compose down` / `tilt down`)
- [ ] Close/repurpose terminals on switch
- [ ] Reset k8s context if needed

### Conflict handling
- [ ] Check port availability before start
- [ ] Check current k8s context before switch
- [ ] Switch context only if different
- [ ] Fail with clear message, not silently

### UI
- [ ] Real per-step state (running/stopped/failed/needs attention)
- [ ] Manual override / force-stop option

## Tier 3 — vision (not scoped yet)

- [ ] Read machine specs (RAM/CPU/disk)
- [ ] Warn/block if specs can't support parallel run
- [ ] Dynamic port allocation
- [ ] Isolated docker networks per workspace
- [ ] Separate k8s namespaces/contexts concurrently
- [ ] Track N independent process trees, not one

## Rule while building

- Do not touch Tier 2/3 items until Tier 1 ships
- Do not add steps not on this list mid-build
- If a new idea surfaces, write it under Tier 3, move on
