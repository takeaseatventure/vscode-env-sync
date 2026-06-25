'use strict';

/**
 * License Client — Embeds in VS Code/Chrome extensions to validate Pro licenses
 * against the DevForge license server.
 * 
 * Zero dependencies. Uses Node.js https module (works in VS Code extension host).
 * For Chrome extensions, a fetch-based variant is provided separately.
 * 
 * Usage:
 *   const client = new LicenseClient({
 *     productId: 'bundle-size-analyzer',
 *     serverUrl: 'https://license.devforge.dev',
 *     secret: 'shared-secret-for-signing'  // server-side validation only
 *   });
 *   
 *   const result = await client.validate('XXXX-XXXX-XXXX-XXXX');
 *   if (result.valid) {
 *     // Unlock Pro features
 *   }
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

class LicenseClient {
  /**
   * @param {Object} options
   * @param {string} options.productId - This extension's product ID
   * @param {string} options.serverUrl - License server base URL
   * @param {string} [options.machineId] - Unique machine identifier (auto-generated if omitted)
   * @param {number} [options.timeout=5000] - Request timeout in ms
   * @param {Object} [options.cache] - Cache storage (defaults to in-memory Map)
   */
  constructor(options) {
    if (!options || !options.productId || !options.serverUrl) {
      throw new Error('LicenseClient requires productId and serverUrl');
    }
    this.productId = options.productId;
    this.serverUrl = options.serverUrl.replace(/\/$/, '');
    this.timeout = options.timeout || 5000;
    this.machineId = options.machineId || this._generateMachineId();
    
    // Simple in-memory cache: { key, valid, expiry, productId }
    this._cache = options.cache || new Map();
    this._cacheKey = '__devforge_license_cache__';
    
    // Load from cache on construction
    this._cached = this._loadCache();
  }

  // ─── Public API ────────────────────────────────────────────────────

  /**
   * Validate a license key against the server.
   * @param {string} licenseKey - The license key to validate
   * @returns {Promise<{valid: boolean, productId?: string, sku?: string, expiresAt?: string, machineId?: string, error?: string, cached?: boolean}>}
   */
  async validate(licenseKey) {
    if (!licenseKey || typeof licenseKey !== 'string') {
      return { valid: false, error: 'No license key provided' };
    }

    const key = licenseKey.trim();

    // Check cache first (valid for 24 hours)
    if (this._cached && this._cached.key === key && this._isCacheValid()) {
      return { ...this._cached.result, cached: true };
    }

    try {
      const result = await this._request('/v1/validate', {
        key,
        productId: this.productId,
        machineId: this.machineId,
      });

      if (result.valid) {
        this._saveCache(key, result);
      } else {
        this._clearCache();
      }

      return result;
    } catch (err) {
      // On network error, use cached result if available (graceful degradation)
      if (this._cached && this._cached.key === key) {
        return { ...this._cached.result, cached: true, networkError: true };
      }
      return { valid: false, error: err.message, networkError: true };
    }
  }

  /**
   * Activate a license key on this machine (first-time activation).
   * Some license servers require activation before validation works.
   * @param {string} licenseKey
   * @returns {Promise<{valid: boolean, activated: boolean, error?: string}>}
   */
  async activate(licenseKey) {
    if (!licenseKey) {
      return { valid: false, activated: false, error: 'No license key provided' };
    }

    const key = licenseKey.trim();

    try {
      const result = await this._request('/v1/activate', {
        key,
        productId: this.productId,
        machineId: this.machineId,
      });

      if (result.valid) {
        this._saveCache(key, result);
      }

      return { ...result, activated: result.valid };
    } catch (err) {
      return { valid: false, activated: false, error: err.message, networkError: true };
    }
  }

  /**
   * Check if the current cached license is valid (no network call).
   * @returns {boolean}
   */
  isProUnlocked() {
    return !!(this._cached && this._isCacheValid() && this._cached.result.valid);
  }

  /**
   * Get the cached license key (if any).
   * @returns {string|null}
   */
  getCachedKey() {
    return this._cached ? this._cached.key : null;
  }

  /**
   * Clear the local license cache (sign out of Pro).
   */
  signOut() {
    this._clearCache();
  }

  // ─── Internal ──────────────────────────────────────────────────────

  /**
   * Make an HTTP/HTTPS request to the license server.
   * @private
   */
  _request(path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.serverUrl + path);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      
      const postData = JSON.stringify(body);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: this.timeout,
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch {
            reject(new Error('Invalid response from license server'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('License server request timed out'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Generate a semi-unique machine ID from system info.
   * @private
   */
  _generateMachineId() {
    const os = require('os');
    const crypto = require('crypto');
    const parts = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || 'unknown',
      Object.keys(os.networkInterfaces()).join(','),
    ].join('|');
    return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 32);
  }

  /**
   * Check if cache is still valid (24-hour TTL).
   * @private
   */
  _isCacheValid() {
    if (!this._cached || !this._cached.expiry) return false;
    return Date.now() < this._cached.expiry;
  }

  /**
   * Load cache from storage.
   * @private
   */
  _loadCache() {
    if (this._cache instanceof Map) {
      return this._cache.get(this._cacheKey) || null;
    }
    // Support VS Code globalState / Chrome storage
    if (this._cache && typeof this._cache.get === 'function') {
      const val = this._cache.get(this._cacheKey);
      return typeof val === 'string' ? JSON.parse(val) : val;
    }
    return null;
  }

  /**
   * Save validation result to cache.
   * @private
   */
  _saveCache(key, result) {
    this._cached = {
      key,
      result: {
        valid: result.valid,
        productId: result.productId,
        sku: result.sku,
        expiresAt: result.expiresAt,
        machineId: this.machineId,
      },
      expiry: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
    };
    
    if (this._cache instanceof Map) {
      this._cache.set(this._cacheKey, this._cached);
    } else if (this._cache && typeof this._cache.update === 'function') {
      // VS Code globalState
      this._cache.update(this._cacheKey, JSON.stringify(this._cached));
    }
  }

  /**
   * Clear cache.
   * @private
   */
  _clearCache() {
    this._cached = null;
    if (this._cache instanceof Map) {
      this._cache.delete(this._cacheKey);
    } else if (this._cache && typeof this._cache.update === 'function') {
      this._cache.update(this._cacheKey, undefined);
    }
  }
}

module.exports = { LicenseClient };
