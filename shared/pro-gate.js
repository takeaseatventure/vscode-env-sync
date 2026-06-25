'use strict';

/**
 * Pro Gate — Shared module for gating Pro features in DevForge extensions.
 * 
 * Integrates the LicenseClient with VS Code's UI to provide a seamless
 * free → Pro upgrade experience:
 *   - Free users see Pro features with a gentle "Pro" badge
 *   - When they try to use a Pro feature, they get an upgrade prompt
 *   - After entering a license key, all Pro features unlock
 *   - Validation is cached for 24 hours (offline-friendly)
 * 
 * Usage in an extension's activate():
 *   const { ProGate } = require('../shared/pro-gate');
 *   const gate = new ProGate(context, { productId: 'bundle-size-analyzer' });
 *   await gate.init();
 *   
 *   if (gate.isPro()) {
 *     // Show Pro features
 *   }
 *   
 *   await gate.guard(() => {
 *     // This code only runs if Pro is unlocked
 *   });
 */

const vscode = require('vscode');
const { LicenseClient } = require('./license-client/index');

const SERVER_URL = 'https://license.devforge.dev';
const UPGRADE_URL = 'https://devforge.dev';
const SETTING_KEY = 'devforge.licenseKey';

class ProGate {
  /**
   * @param {vscode.ExtensionContext} context
   * @param {Object} options
   * @param {string} options.productId - This extension's product ID
   * @param {string} [options.displayName] - Human-readable name for prompts
   */
  constructor(context, options) {
    this.context = context;
    this.productId = options.productId;
    this.displayName = options.displayName || 'DevForge';
    this._pro = false;
    this._client = null;
    this._statusBarItem = null;
  }

  /**
   * Initialize: create license client, check cached license, set up UI.
   */
  async init() {
    // Create license client with VS Code globalState as cache
    this._client = new LicenseClient({
      productId: this.productId,
      serverUrl: SERVER_URL,
      cache: this.context.globalState,
    });

    // Check if there's a cached valid license
    this._pro = this._client.isProUnlocked();

    // Try to validate the stored key if we have one (non-blocking)
    const storedKey = this.context.globalState.get(SETTING_KEY);
    if (storedKey && !this._pro) {
      try {
        const result = await this._client.validate(storedKey);
        this._pro = result.valid;
      } catch {
        // Network error — will use cache or stay free
      }
    }

    this._updateStatusBar();
  }

  /**
   * Check if Pro features are unlocked.
   * @returns {boolean}
   */
  isPro() {
    return this._pro;
  }

  /**
   * Guard a Pro-only feature. If not Pro, shows upgrade prompt.
   * @param {Function} fn - Function to run if Pro is unlocked
   * @param {Object} [opts] - Options
   * @param {string} [opts.featureName] - Name of the Pro feature for the prompt
   * @returns {Promise<any>} Result of fn, or undefined if not Pro
   */
  async guard(fn, opts = {}) {
    if (this._pro) {
      return fn();
    }

    const featureName = opts.featureName || 'this feature';
    const action = await vscode.window.showInformationMessage(
      `${featureName} is a DevForge Pro feature. Upgrade to unlock it.`,
      'Enter License Key',
      'Get Pro',
      'Maybe Later'
    );

    if (action === 'Enter License Key') {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your DevForge Pro license key',
        placeHolder: 'XXXX-XXXX-XXXX-XXXX',
        ignoreFocusOut: true,
        validateInput: (v) => {
          if (!v || v.trim().length < 10) return 'License key looks too short';
          return null;
        },
      });

      if (key) {
        const success = await this.activate(key);
        if (success) {
          vscode.window.showInformationMessage(
            `✅ ${this.displayName} Pro activated! Enjoy all features.`
          );
          return fn(); // Run the guarded function now
        } else {
          vscode.window.showErrorMessage(
            'Invalid license key. Check your key and try again.'
          );
        }
      }
    } else if (action === 'Get Pro') {
      vscode.env.openExternal(vscode.Uri.parse(UPGRADE_URL));
    }

    return undefined;
  }

  /**
   * Activate a license key.
   * @param {string} key
   * @returns {Promise<boolean>} true if activation succeeded
   */
  async activate(key) {
    try {
      const result = await this._client.validate(key);
      if (result.valid) {
        this._pro = true;
        await this.context.globalState.update(SETTING_KEY, key);
        this._updateStatusBar();
        return true;
      }
      return false;
    } catch {
      // On network error, if we have a cached valid result, allow it
      if (result && result.cached) {
        this._pro = true;
        this._updateStatusBar();
        return true;
      }
      return false;
    }
  }

  /**
   * Sign out of Pro (clear license).
   */
  signOut() {
    this._client.signOut();
    this._pro = false;
    this.context.globalState.update(SETTING_KEY, undefined);
    this._updateStatusBar();
  }

  /**
   * Show/refresh the Pro status bar indicator.
   */
  _updateStatusBar() {
    if (!this._statusBarItem) {
      this._statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        0
      );
      this._statusBarItem.command = 'devforge.manageLicense';
    }

    if (this._pro) {
      this._statusBarItem.text = '$(sparkle) Pro';
      this._statusBarItem.tooltip = `${this.displayName} Pro — Active`;
      this._statusBarItem.show();
    } else {
      this._statusBarItem.text = '$(unlock) Get Pro';
      this._statusBarItem.tooltip = `Unlock ${this.displayName} Pro features`;
      this._statusBarItem.show();
    }
  }

  /**
   * Register the "Manage License" command.
   * Call this from activate() to wire up the status bar click.
   */
  registerCommands(context) {
    const cmd = vscode.commands.registerCommand('devforge.manageLicense', async () => {
      if (this._pro) {
        const action = await vscode.window.showInformationMessage(
          `${this.displayName} Pro is active.`,
          'Sign Out',
          'OK'
        );
        if (action === 'Sign Out') {
          this.signOut();
          vscode.window.showInformationMessage('Signed out of Pro.');
        }
      } else {
        const action = await vscode.window.showInformationMessage(
          `Unlock ${this.displayName} Pro for advanced features.`,
          'Enter License Key',
          'Get Pro'
        );
        if (action === 'Enter License Key') {
          const key = await vscode.window.showInputBox({
            prompt: 'Enter your DevForge Pro license key',
            placeHolder: 'XXXX-XXXX-XXXX-XXXX',
            ignoreFocusOut: true,
          });
          if (key) {
            const success = await this.activate(key);
            if (success) {
              vscode.window.showInformationMessage('Pro activated!');
            } else {
              vscode.window.showErrorMessage('Invalid license key.');
            }
          }
        } else if (action === 'Get Pro') {
          vscode.env.openExternal(vscode.Uri.parse(UPGRADE_URL));
        }
      }
    });
    context.subscriptions.push(cmd);
  }
}

module.exports = { ProGate };
