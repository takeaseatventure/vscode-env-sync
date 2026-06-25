'use strict';

/**
 * Env Sync — VS Code Extension Entry Point
 * 
 * Commands:
 * - envsync.generate: Scan workspace, generate/sync .env.example
 * - envsync.validate: Check .env against .env.example for missing vars
 * - envsync.diff:     Show missing/extra variables in a diff view
 * - envsync.scan:     Scan the current active file for env vars
 */

const vscode = require('vscode');
const path = require('path');
const scanner = require('./lib/scanner');
const { ProGate } = require('./shared/pro-gate');

const OUTPUT_CHANNEL = vscode.window.createOutputChannel('Env Sync');
let proGate;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  context.subscriptions.push(OUTPUT_CHANNEL);

  // Initialize Pro gate
  proGate = new ProGate(context, {
    productId: 'env-sync',
    displayName: 'Env Sync',
  });
  proGate.registerCommands(context);
  proGate.init();

  // --- Command: Generate .env.example ---
  const generateCmd = vscode.commands.registerCommand('envsync.generate', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showWarningMessage('Env Sync: Open a workspace folder first.');
      return;
    }

    const config = vscode.workspace.getConfiguration('envsync');
    const outputFile = config.get('outputFile') || '.env.example';
    const excludeDirs = config.get('excludeDirs') || scanner.DEFAULT_EXCLUDE_DIRS;
    const scanExtensions = config.get('scanExtensions') || scanner.DEFAULT_EXTENSIONS;
    const includeComments = config.get('includeComments') !== false;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Env Sync: Scanning for environment variables...',
      cancellable: false,
    }, async (progress) => {
      try {
        const rootPath = workspaceFolders[0].uri.fsPath;
        const scannedVars = await scanWorkspace(rootPath, excludeDirs, scanExtensions, progress);
        const varCount = Object.keys(scannedVars).length;

        if (varCount === 0) {
          vscode.window.showInformationMessage('Env Sync: No environment variables found in workspace.');
          return;
        }

        // Check for existing .env.example to preserve values
        const exampleUri = vscode.Uri.file(path.join(rootPath, outputFile));
        let existingValues = {};
        try {
          const doc = await vscode.workspace.openTextDocument(exampleUri);
          const parsed = scanner.parseEnvFile(doc.getText());
          existingValues = Object.entries(parsed).reduce((acc, [k, v]) => {
            acc[k] = v;
            return acc;
          }, {});
        } catch (e) {
          // File doesn't exist yet — that's fine
        }

        // Generate content
        const content = scanner.generateEnvExample(scannedVars, {
          includeComments,
          existingValues,
        });

        // Write the file
        await vscode.workspace.fs.writeFile(exampleUri, Buffer.from(content, 'utf-8'));

        // Open it for review
        const doc = await vscode.workspace.openTextDocument(exampleUri);
        await vscode.window.showTextDocument(doc);

        vscode.window.showInformationMessage(
          `Env Sync: Generated ${outputFile} with ${varCount} variable${varCount === 1 ? '' : 's'}.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Env Sync: Error — ${err.message}`);
      }
    });
  });

  // --- Command: Validate .env against .env.example ---
  const validateCmd = vscode.commands.registerCommand('envsync.validate', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showWarningMessage('Env Sync: Open a workspace folder first.');
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    try {
      const envUri = vscode.Uri.file(path.join(rootPath, '.env'));
      const exampleUri = vscode.Uri.file(path.join(rootPath, '.env.example'));

      let envContent, exampleContent;
      try {
        envContent = (await vscode.workspace.openTextDocument(envUri)).getText();
      } catch (e) {
        vscode.window.showErrorMessage('Env Sync: No .env file found.');
        return;
      }
      try {
        exampleContent = (await vscode.workspace.openTextDocument(exampleUri)).getText();
      } catch (e) {
        vscode.window.showErrorMessage('Env Sync: No .env.example file found. Run "Generate" first.');
        return;
      }

      const envVars = scanner.parseEnvFile(envContent);
      const exampleVars = scanner.parseEnvFile(exampleContent);

      const diff = scanner.diffEnvFiles(envVars, exampleVars);
      // diff here compares env vs example — we want vars in example missing from env
      const missingInEnv = diff.extra; // in example but not in env
      const extraInEnv = diff.missing; // in env but not in example

      OUTPUT_CHANNEL.clear();
      OUTPUT_CHANNEL.appendLine('=== Env Sync: Validation Report ===\n');

      if (missingInEnv.length === 0 && extraInEnv.length === 0) {
        OUTPUT_CHANNEL.appendLine('✓ .env matches .env.example — all variables accounted for.');
        vscode.window.showInformationMessage('Env Sync: .env matches .env.example. All good!');
      } else {
        if (missingInEnv.length > 0) {
          OUTPUT_CHANNEL.appendLine(`⚠ Missing in .env (${missingInEnv.length}):`);
          for (const v of missingInEnv) {
            OUTPUT_CHANNEL.appendLine(`  ${v}`);
          }
        }
        if (extraInEnv.length > 0) {
          OUTPUT_CHANNEL.appendLine(`\nℹ Extra in .env (not in .env.example) (${extraInEnv.length}):`);
          for (const v of extraInEnv) {
            OUTPUT_CHANNEL.appendLine(`  ${v}`);
          }
        }
        OUTPUT_CHANNEL.show();
        vscode.window.showWarningMessage(
          `Env Sync: ${missingInEnv.length} missing, ${extraInEnv.length} extra variables. See output.`
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Env Sync: Error — ${err.message}`);
    }
  });

  // --- Command: Show missing/extra variables ---
  const diffCmd = vscode.commands.registerCommand('envsync.diff', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('envsync');
    const excludeDirs = config.get('excludeDirs') || scanner.DEFAULT_EXCLUDE_DIRS;
    const scanExtensions = config.get('scanExtensions') || scanner.DEFAULT_EXTENSIONS;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Env Sync: Comparing code against .env.example...',
      cancellable: false,
    }, async () => {
      try {
        const scannedVars = await scanWorkspace(rootPath, excludeDirs, scanExtensions);

        const exampleUri = vscode.Uri.file(path.join(rootPath, '.env.example'));
        let exampleVars = {};
        try {
          const doc = await vscode.workspace.openTextDocument(exampleUri);
          exampleVars = scanner.parseEnvFile(doc.getText());
        } catch (e) {
          // No example file
        }

        const diff = scanner.diffEnvFiles(scannedVars, exampleVars);

        OUTPUT_CHANNEL.clear();
        OUTPUT_CHANNEL.appendLine('=== Env Sync: Diff Report ===\n');
        OUTPUT_CHANNEL.appendLine(`Variables in code: ${Object.keys(scannedVars).length}`);
        OUTPUT_CHANNEL.appendLine(`Variables in .env.example: ${Object.keys(exampleVars).length}\n`);

        if (diff.missing.length > 0) {
          OUTPUT_CHANNEL.appendLine(`⚠ Missing from .env.example (${diff.missing.length}):`);
          for (const v of diff.missing) {
            const info = scannedVars[v];
            const fileNote = info.files && info.files[0]
              ? `  (first used in ${info.files[0].relativePath}:${info.files[0].line})`
              : '';
            OUTPUT_CHANNEL.appendLine(`  ${v}${fileNote}`);
          }
        }

        if (diff.extra.length > 0) {
          OUTPUT_CHANNEL.appendLine(`\nℹ Extra in .env.example (not found in code) (${diff.extra.length}):`);
          for (const v of diff.extra) {
            OUTPUT_CHANNEL.appendLine(`  ${v}`);
          }
        }

        if (diff.missing.length === 0 && diff.extra.length === 0) {
          OUTPUT_CHANNEL.appendLine('✓ Perfect sync — .env.example matches all env vars used in code.');
        }

        OUTPUT_CHANNEL.show();
      } catch (err) {
        vscode.window.showErrorMessage(`Env Sync: Error — ${err.message}`);
      }
    });
  });

  // --- Command: Scan current file ---
  const scanFileCmd = vscode.commands.registerCommand('envsync.scan', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Env Sync: No active file.');
      return;
    }

    const content = editor.document.getText();
    const fileName = path.basename(editor.document.fileName);
    const vars = scanner.scanContent(content);
    const varNames = Object.keys(vars);

    if (varNames.length === 0) {
      vscode.window.showInformationMessage(`Env Sync: No environment variables in ${fileName}.`);
      return;
    }

    OUTPUT_CHANNEL.clear();
    OUTPUT_CHANNEL.appendLine(`=== Env Sync: Scan of ${fileName} ===\n`);
    OUTPUT_CHANNEL.appendLine(`Found ${varNames.length} environment variable${varNames.length === 1 ? '' : 's'}:\n`);
    for (const v of varNames.sort()) {
      OUTPUT_CHANNEL.appendLine(`  ${v} (${vars[v]} reference${vars[v] === 1 ? '' : 's'})`);
    }
    OUTPUT_CHANNEL.show();

    vscode.window.showInformationMessage(
      `Env Sync: Found ${varNames.length} env var${varNames.length === 1 ? '' : 's'} in ${fileName}.`
    );
  });

  // --- PRO Command: Export validation report ---
  const exportReportCmd = vscode.commands.registerCommand('envsync.exportReport', async () => {
    await proGate.guard(async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showWarningMessage('Env Sync: Open a workspace folder first.');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = vscode.workspace.getConfiguration('envsync');
      const excludeDirs = config.get('excludeDirs') || scanner.DEFAULT_EXCLUDE_DIRS;
      const scanExtensions = config.get('scanExtensions') || scanner.DEFAULT_EXTENSIONS;

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Env Sync: Generating coverage report (Pro)...',
        cancellable: false,
      }, async () => {
        const scannedVars = await scanWorkspace(rootPath, excludeDirs, scanExtensions);

        // Read .env.example
        let exampleVars = {};
        try {
          const exampleUri = vscode.Uri.file(path.join(rootPath, '.env.example'));
          const doc = await vscode.workspace.openTextDocument(exampleUri);
          exampleVars = scanner.parseEnvFile(doc.getText());
        } catch { /* no example file */ }

        // Read .env
        let envVars = {};
        try {
          const envUri = vscode.Uri.file(path.join(rootPath, '.env'));
          const doc = await vscode.workspace.openTextDocument(envUri);
          envVars = scanner.parseEnvFile(doc.getText());
        } catch { /* no .env file */ }

        const allScanned = Object.keys(scannedVars).sort();
        const inExample = Object.keys(exampleVars);
        const inEnv = Object.keys(envVars);

        // Build report
        let md = `# Env Sync Coverage Report\n\n`;
        md += `**Generated:** ${new Date().toISOString()}\n\n`;
        md += `## Summary\n\n`;
        md += `- Variables found in code: **${allScanned.length}**\n`;
        md += `- Variables in .env.example: **${inExample.length}**\n`;
        md += `- Variables in .env: **${inEnv.length}**\n`;
        md += `- Missing from .env.example: **${allScanned.filter(v => !inExample.includes(v)).length}**\n`;
        md += `- Missing from .env: **${inExample.filter(v => !inEnv.includes(v)).length}**\n\n`;
        md += `## Detailed Variable Coverage\n\n`;
        md += `| Variable | In Code | In .env.example | In .env | Files Using It |\n`;
        md += `|----------|---------|-----------------|---------|----------------|\n`;

        const allVars = [...new Set([...allScanned, ...inExample, ...inEnv])].sort();
        for (const v of allVars) {
          const inCode = allScanned.includes(v) ? '✅' : '—';
          const inEx = inExample.includes(v) ? '✅' : '❌';
          const inE = inEnv.includes(v) ? '✅' : '❌';
          const files = scannedVars[v]?.files?.map(f => `${f.relativePath}:${f.line}`).join(', ') || '—';
          md += `| \`${v}\` | ${inCode} | ${inEx} | ${inE} | ${files} |\n`;
        }

        // Write report file
        const reportUri = vscode.Uri.file(path.join(rootPath, 'env-coverage-report.md'));
        await vscode.workspace.fs.writeFile(reportUri, Buffer.from(md, 'utf-8'));
        const doc = await vscode.workspace.openTextDocument(reportUri);
        await vscode.window.showTextDocument(doc);

        vscode.window.showInformationMessage(
          `Env Sync Pro: Coverage report generated with ${allVars.length} variables.`
        );
      });
    }, { featureName: 'Export Coverage Report (Pro)' });
  });

  context.subscriptions.push(generateCmd, validateCmd, diffCmd, scanFileCmd, exportReportCmd);
}

/**
 * Scan the entire workspace for environment variables.
 * @param {string} rootPath - Workspace root
 * @param {string[]} excludeDirs - Directories to skip
 * @param {string[]} scanExtensions - File extensions to scan
 * @param {Function} progress - Optional progress reporter
 * @returns {Promise<Object>} Map of varName -> { files: [{relativePath, line, lang}], count }
 */
async function scanWorkspace(rootPath, excludeDirs, scanExtensions, progress) {
  const results = {};

  // Use VS Code's file search to find files
  const files = await vscode.workspace.findFiles(
    '**/*',
    `{${excludeDirs.map(d => `**/${d}/**`).join(',')}}`
  );

  const scannableFiles = files.filter(f => scanner.shouldScanFile(f.fsPath, scanExtensions));
  
  let scanned = 0;
  for (const fileUri of scannableFiles) {
    if (progress) {
      progress.report({ message: `Scanning ${++scanned}/${scannableFiles.length}` });
    }

    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const content = doc.getText();
      const relativePath = path.relative(rootPath, fileUri.fsPath);
      const ext = path.extname(fileUri.fsPath);
      const lang = scanner.languageFromExtension(ext);

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const vars = scanner.scanLine(lines[i]);
        for (const v of vars) {
          if (!results[v]) {
            results[v] = { files: [], count: 0 };
          }
          results[v].count++;
          if (results[v].files.length < 3) { // Cap at 3 locations per var
            results[v].files.push({
              relativePath,
              line: i + 1,
              lang,
            });
          }
        }
      }
    } catch (e) {
      // Skip unreadable files
    }
  }

  return results;
}

function deactivate() {}

module.exports = { activate, deactivate };
