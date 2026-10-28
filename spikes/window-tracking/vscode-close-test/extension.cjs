// Spike test for question F: can an extension close its own VS Code
// window via workbench.action.closeWindow? Writes a marker file next to
// itself right before asking, so run.sh can tell "never tried" apart
// from "tried and the window stayed".
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extensions as CommonJS */
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

function activate() {
  setTimeout(() => {
    fs.writeFileSync(path.join(__dirname, '.marker'), `invoked ${new Date().toISOString()}\n`);
    vscode.commands.executeCommand('workbench.action.closeWindow');
  }, 3000);
}

module.exports = { activate };
