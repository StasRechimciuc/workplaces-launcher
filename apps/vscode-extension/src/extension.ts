import * as vscode from 'vscode';

/**
 * Companion extension for Workspace Launcher. Reading a workspace
 * config on activation, creating terminal(s) via createTerminal(), and
 * running commands via terminal.sendText() (docs/build-shell.md "VS
 * Code companion extension") is Tier 1 feature work — this is the
 * activation scaffold only, no real behavior yet beyond proving the
 * extension loads and can register a command.
 */
export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('workspaceLauncher.ping', () => {
    void vscode.window.showInformationMessage('Workspace Launcher extension is active.');
  });
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // Nothing to clean up yet.
}
