'use strict';

/**
 * Env Sync — Scanner
 * 
 * Multi-language environment variable scanner.
 * Proven regex patterns extracted from the envdoc CLI (6 languages).
 * 
 * Design decisions documented in env-var-scan-patterns.md:
 * - Minimum 2-character names (single-letter env vars are vanishingly rare)
 * - Uppercase only (real env vars are UPPER_SNAKE_CASE)
 * - Alternation capture groups for multiple syntactic forms
 */

// --- Scanner patterns (proven, from envdoc CLI) ---

// 1. Node/Bun: process.env.NAME and process.env['NAME']
const NODE_PATTERN = /process\.env(?:\[['"]([A-Z0-9_]{2,})['"]\]|\s*\.\s*([A-Z0-9_]{2,}))/g;

// 2. Python: os.environ.get('NAME'), os.environ['NAME']
const PYTHON_ENVIRON_PATTERN = /os\.environ(?:\.get)?\(\s*['"]([A-Z0-9_]{2,})['"]\s*\)|os\.environ\[['"]([A-Z0-9_]{2,})['"]\]/g;

// 3. Python: os.getenv('NAME')
const PYTHON_GETENV_PATTERN = /os\.getenv\(\s*['"]([A-Z0-9_]{2,})['"]\s*\)/g;

// 4. Java: System.getenv("NAME")
const JAVA_PATTERN = /System\.getenv\(\s*"([A-Z0-9_]{2,})"\s*\)/g;

// 5. Ruby: ENV['NAME']
const RUBY_PATTERN = /\bENV\[['"]([A-Z0-9_]{2,})['"]\]/g;

// 6. Rust: env::var("NAME")
const RUST_PATTERN = /env::var\(\s*"([A-Z0-9_]{2,})"\s*\)/g;

// 7. Go: os.LookupEnv("NAME")
const GO_PATTERN = /os\.LookupEnv\(\s*"([A-Z0-9_]{2,})"\s*\)/g;

/**
 * All patterns combined. Each entry has:
 * - re: the regex (with /g flag)
 * - groups: array of capture-group indices that may hold the var name
 */
const ALL_PATTERNS = [
  { re: NODE_PATTERN, groups: [1, 2] },
  { re: PYTHON_ENVIRON_PATTERN, groups: [1, 2] },
  { re: PYTHON_GETENV_PATTERN, groups: [1] },
  { re: JAVA_PATTERN, groups: [1] },
  { re: RUBY_PATTERN, groups: [1] },
  { re: RUST_PATTERN, groups: [1] },
  { re: GO_PATTERN, groups: [1] },
];

/**
 * Default file extensions to scan
 */
const DEFAULT_EXTENSIONS = [
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
  '.py', '.java', '.rb', '.rs', '.go', '.sh',
];

/**
 * Default directories to skip
 */
const DEFAULT_EXCLUDE_DIRS = [
  'node_modules', '.git', 'vendor', 'dist', 'build', '.next', '.nuxt',
  'target', '__pycache__', '.venv', 'venv', 'env', '.env',
  'coverage', '.cache', '.turbo', '.svelte-kit',
];

/**
 * Scan a single line of code and extract all environment variable references.
 * @param {string} line - A single line of source code
 * @returns {string[]} Array of env var names found on this line
 */
function scanLine(line) {
  const found = new Set();

  for (const { re, groups } of ALL_PATTERNS) {
    re.lastIndex = 0; // Reset between lines (pitfall: lastIndex leaks)
    let match;
    
    // Loop: a single line can reference multiple env vars
    while ((match = re.exec(line)) !== null) {
      for (const g of groups) {
        if (match[g]) {
          found.add(match[g]);
          break;
        }
      }
    }
  }

  return Array.from(found);
}

/**
 * Scan a full source code string (multiple lines).
 * @param {string} content - Full source code
 * @returns {Object} Map of varName -> count (number of references)
 */
function scanContent(content) {
  const results = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const vars = scanLine(line);
    for (const v of vars) {
      results[v] = (results[v] || 0) + 1;
    }
  }

  return results;
}

/**
 * Determine the language from a file extension.
 * @param {string} ext - File extension (e.g. '.js', '.py')
 * @returns {string} Language name, or 'unknown'
 */
function languageFromExtension(ext) {
  const map = {
    '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.ts': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
    '.jsx': 'JSX', '.tsx': 'TSX',
    '.py': 'Python',
    '.java': 'Java',
    '.rb': 'Ruby',
    '.rs': 'Rust',
    '.go': 'Go',
    '.sh': 'Shell',
  };
  return map[ext] || 'unknown';
}

/**
 * Check if a directory name should be excluded from scanning.
 * @param {string} dirName - Directory name (not full path)
 * @param {string[]} excludeDirs - Array of directory names to exclude
 * @returns {boolean} true if directory should be skipped
 */
function shouldExcludeDir(dirName, excludeDirs) {
  if (dirName.startsWith('.')) return true; // Skip hidden dirs
  return excludeDirs.includes(dirName);
}

/**
 * Check if a file should be scanned based on its extension.
 * @param {string} fileName - File name
 * @param {string[]} extensions - Array of extensions to scan (e.g. ['.js', '.py'])
 * @returns {boolean} true if file should be scanned
 */
function shouldScanFile(fileName, extensions) {
  for (const ext of extensions) {
    if (fileName.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Parse an existing .env or .env.example file.
 * Extracts variable names and their values (if any).
 * @param {string} content - .env file content
 * @returns {Object} Map of varName -> { value: string, hasValue: boolean, comment: string }
 */
function parseEnvFile(content) {
  const vars = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match: KEY=value, KEY = value, export KEY=value
    const match = trimmed.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      const name = match[1];
      let value = match[2].trim();
      
      // Strip inline comment
      const commentMatch = value.match(/^(.*?)\s+#\s*(.*)$/);
      let comment = '';
      if (commentMatch) {
        value = commentMatch[1].trim();
        comment = commentMatch[2];
      }
      
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      vars[name] = {
        value: value,
        hasValue: value.length > 0 && value !== '',
        comment: comment,
      };
    }
  }

  return vars;
}

/**
 * Generate .env.example content from scanned variables.
 * @param {Object} scannedVars - Map of varName -> { files: [{file, line, lang}], count }
 * @param {Object} options - { includeComments: boolean, existingValues: Object }
 * @returns {string} Generated .env.example content
 */
function generateEnvExample(scannedVars, options) {
  const opts = options || {};
  const includeComments = opts.includeComments !== false;
  const existingValues = opts.existingValues || {};

  // Sort variables alphabetically
  const sortedNames = Object.keys(scannedVars).sort();

  if (sortedNames.length === 0) {
    return '# No environment variables found in scanned files\n';
  }

  const lines = [
    '# Environment Variables',
    '# This file was auto-generated by Env Sync',
    '# Do not commit real secrets — use this as documentation only',
    '',
  ];

  for (const name of sortedNames) {
    const info = scannedVars[name];
    const existingValue = existingValues[name];
    
    // Use placeholder if we have a known value, otherwise empty
    let value = '';
    if (existingValue && existingValue.hasValue) {
      value = existingValue.value;
    }

    lines.push(`${name}=${value}`);

    if (includeComments && info.files && info.files.length > 0) {
      const firstFile = info.files[0];
      const fileCount = info.files.length;
      const fileNote = fileCount === 1
        ? `# Used in: ${firstFile.relativePath}:${firstFile.line}`
        : `# Used in ${fileCount} files (first: ${firstFile.relativePath}:${firstFile.line})`;
      lines.push(fileNote);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Compare scanned vars against an existing .env.example file.
 * Returns missing (in code but not in example) and extra (in example but not in code).
 * @param {Object} scannedVars - Map of varName -> info (from scanContent)
 * @param {Object} exampleVars - Map of varName -> info (from parseEnvFile)
 * @returns {Object} { missing: string[], extra: string[] }
 */
function diffEnvFiles(scannedVars, exampleVars) {
  const scannedNames = new Set(Object.keys(scannedVars));
  const exampleNames = new Set(Object.keys(exampleVars));

  const missing = [];
  const extra = [];

  for (const name of scannedNames) {
    if (!exampleNames.has(name)) {
      missing.push(name);
    }
  }

  for (const name of exampleNames) {
    if (!scannedNames.has(name)) {
      extra.push(name);
    }
  }

  return {
    missing: missing.sort(),
    extra: extra.sort(),
  };
}

module.exports = {
  scanLine,
  scanContent,
  languageFromExtension,
  shouldExcludeDir,
  shouldScanFile,
  parseEnvFile,
  generateEnvExample,
  diffEnvFiles,
  DEFAULT_EXTENSIONS,
  DEFAULT_EXCLUDE_DIRS,
};
