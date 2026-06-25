'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const scanner = require('../lib/scanner');

// --- scanLine tests ---

test('scanLine detects Node.js process.env.NAME', () => {
  assert.deepStrictEqual(scanner.scanLine('const key = process.env.API_KEY;'), ['API_KEY']);
});

test('scanLine detects Node.js process.env["NAME"]', () => {
  assert.deepStrictEqual(scanner.scanLine('const key = process.env["API_KEY"];'), ['API_KEY']);
});

test('scanLine detects Node.js process.env[\'NAME\']', () => {
  assert.deepStrictEqual(scanner.scanLine("const key = process.env['API_KEY'];"), ['API_KEY']);
});

test('scanLine detects Python os.environ.get()', () => {
  assert.deepStrictEqual(scanner.scanLine("key = os.environ.get('DATABASE_URL')"), ['DATABASE_URL']);
});

test('scanLine detects Python os.getenv()', () => {
  assert.deepStrictEqual(scanner.scanLine("key = os.getenv('SECRET_KEY')"), ['SECRET_KEY']);
});

test('scanLine detects Python os.environ["X"]', () => {
  assert.deepStrictEqual(scanner.scanLine('val = os.environ["REDIS_URL"]'), ['REDIS_URL']);
});

test('scanLine detects Java System.getenv()', () => {
  assert.deepStrictEqual(scanner.scanLine('String key = System.getenv("AWS_SECRET");'), ['AWS_SECRET']);
});

test('scanLine detects Ruby ENV["X"]', () => {
  assert.deepStrictEqual(scanner.scanLine('key = ENV["STRIPE_KEY"]'), ['STRIPE_KEY']);
});

test('scanLine detects Ruby ENV[\'X\']', () => {
  assert.deepStrictEqual(scanner.scanLine("key = ENV['STRIPE_KEY']"), ['STRIPE_KEY']);
});

test('scanLine detects Rust env::var()', () => {
  assert.deepStrictEqual(scanner.scanLine('let key = env::var("DATABASE_URL");'), ['DATABASE_URL']);
});

test('scanLine detects Go os.LookupEnv()', () => {
  assert.deepStrictEqual(scanner.scanLine('val, ok := os.LookupEnv("PORT");'), ['PORT']);
});

// --- Multiple variables per line ---

test('scanLine detects multiple env vars on one line', () => {
  const result = scanner.scanLine('const url = process.env.DB_HOST + ":" + process.env.DB_PORT;');
  assert.ok(result.includes('DB_HOST'));
  assert.ok(result.includes('DB_PORT'));
  assert.strictEqual(result.length, 2);
});

test('scanLine detects multiple Python env vars on one line', () => {
  const result = scanner.scanLine("a = os.getenv('VAR_A'); b = os.getenv('VAR_B')");
  assert.ok(result.includes('VAR_A'));
  assert.ok(result.includes('VAR_B'));
});

// --- Edge cases ---

test('scanLine ignores single-character env var names', () => {
  assert.deepStrictEqual(scanner.scanLine('const x = process.env.A;'), []);
});

test('scanLine ignores lowercase env var names', () => {
  assert.deepStrictEqual(scanner.scanLine('const x = process.env.api_key;'), []);
});

test('scanLine ignores non-env patterns', () => {
  assert.deepStrictEqual(scanner.scanLine('const obj = { env: "production" };'), []);
});

test('scanLine returns empty array for lines with no env vars', () => {
  assert.deepStrictEqual(scanner.scanLine('console.log("hello world");'), []);
});

test('scanLine returns empty array for empty string', () => {
  assert.deepStrictEqual(scanner.scanLine(''), []);
});

// Note: the scanner intentionally matches env vars in comments (over-reporting is
// safer than under-reporting — the user prunes). This is documented behavior.
test('scanLine DOES detect env vars in comments (by design)', () => {
  const result = scanner.scanLine('// process.env.SHOULD_MATCH_IN_COMMENT');
  assert.deepStrictEqual(result, ['SHOULD_MATCH_IN_COMMENT']);
});

test('scanLine detects env var with numbers in name', () => {
  assert.deepStrictEqual(scanner.scanLine('const k = process.env.AWS_S3_BUCKET_2;'), ['AWS_S3_BUCKET_2']);
});

test('scanLine detects env var at start of line', () => {
  assert.deepStrictEqual(scanner.scanLine('process.env.HOST'), ['HOST']);
});

test('scanLine detects env var at end of line', () => {
  assert.deepStrictEqual(scanner.scanLine('foo(process.env.BAR)'), ['BAR']);
});

// --- scanContent tests ---

test('scanContent counts multiple references across lines', () => {
  const content = `
const a = process.env.API_KEY;
const b = process.env["API_KEY"];
const c = process.env.OTHER;
  `;
  const result = scanner.scanContent(content);
  assert.strictEqual(result['API_KEY'], 2);
  assert.strictEqual(result['OTHER'], 1);
});

test('scanContent handles empty content', () => {
  const result = scanner.scanContent('');
  assert.deepStrictEqual(result, {});
});

test('scanContent handles multi-language content', () => {
  const content = `
process.env.NODE_KEY
os.getenv('PYTHON_KEY')
System.getenv("JAVA_KEY")
  `;
  const result = scanner.scanContent(content);
  assert.ok(result['NODE_KEY'] > 0);
  assert.ok(result['PYTHON_KEY'] > 0);
  assert.ok(result['JAVA_KEY'] > 0);
});

// --- languageFromExtension tests ---

test('languageFromExtension maps common extensions', () => {
  assert.strictEqual(scanner.languageFromExtension('.js'), 'JavaScript');
  assert.strictEqual(scanner.languageFromExtension('.ts'), 'TypeScript');
  assert.strictEqual(scanner.languageFromExtension('.py'), 'Python');
  assert.strictEqual(scanner.languageFromExtension('.java'), 'Java');
  assert.strictEqual(scanner.languageFromExtension('.rb'), 'Ruby');
  assert.strictEqual(scanner.languageFromExtension('.rs'), 'Rust');
  assert.strictEqual(scanner.languageFromExtension('.go'), 'Go');
});

test('languageFromExtension returns unknown for unrecognized', () => {
  assert.strictEqual(scanner.languageFromExtension('.txt'), 'unknown');
  assert.strictEqual(scanner.languageFromExtension(''), 'unknown');
});

// --- shouldExcludeDir tests ---

test('shouldExcludeDir excludes known dirs', () => {
  const excludes = ['node_modules', '.git', 'dist'];
  assert.strictEqual(scanner.shouldExcludeDir('node_modules', excludes), true);
  assert.strictEqual(scanner.shouldExcludeDir('src', excludes), false);
});

test('shouldExcludeDir excludes hidden directories', () => {
  assert.strictEqual(scanner.shouldExcludeDir('.hidden', []), true);
  assert.strictEqual(scanner.shouldExcludeDir('.vscode', []), true);
});

test('shouldExcludeDir does not exclude regular dirs', () => {
  assert.strictEqual(scanner.shouldExcludeDir('src', []), false);
  assert.strictEqual(scanner.shouldExcludeDir('components', []), false);
});

// --- shouldScanFile tests ---

test('shouldScanFile matches known extensions', () => {
  const exts = ['.js', '.py'];
  assert.strictEqual(scanner.shouldScanFile('app.js', exts), true);
  assert.strictEqual(scanner.shouldScanFile('main.py', exts), true);
  assert.strictEqual(scanner.shouldScanFile('readme.md', exts), false);
  assert.strictEqual(scanner.shouldScanFile('data.json', exts), false);
});

test('shouldScanFile handles files without extensions', () => {
  assert.strictEqual(scanner.shouldScanFile('Makefile', ['.js']), false);
});

// --- parseEnvFile tests ---

test('parseEnvFile extracts KEY=value pairs', () => {
  const content = 'API_KEY=secret123\nPORT=3000\n';
  const result = scanner.parseEnvFile(content);
  assert.strictEqual(result['API_KEY'].value, 'secret123');
  assert.strictEqual(result['API_KEY'].hasValue, true);
  assert.strictEqual(result['PORT'].value, '3000');
});

test('parseEnvFile handles export prefix', () => {
  const content = 'export DATABASE_URL=postgres://localhost\n';
  const result = scanner.parseEnvFile(content);
  assert.strictEqual(result['DATABASE_URL'].value, 'postgres://localhost');
});

test('parseEnvFile handles spaces around =', () => {
  const content = 'KEY = value\n';
  const result = scanner.parseEnvFile(content);
  assert.strictEqual(result['KEY'].value, 'value');
});

test('parseEnvFile strips quotes', () => {
  const content1 = 'KEY="double quoted"\n';
  const content2 = "KEY='single quoted'\n";
  assert.strictEqual(scanner.parseEnvFile(content1)['KEY'].value, 'double quoted');
  assert.strictEqual(scanner.parseEnvFile(content2)['KEY'].value, 'single quoted');
});

test('parseEnvFile skips comments and empty lines', () => {
  const content = '# This is a comment\n\nAPI_KEY=secret\n';
  const result = scanner.parseEnvFile(content);
  assert.strictEqual(Object.keys(result).length, 1);
  assert.ok(result['API_KEY']);
});

test('parseEnvFile captures inline comments', () => {
  const content = 'API_KEY=secret # my secret\n';
  const result = scanner.parseEnvFile(content);
  assert.strictEqual(result['API_KEY'].value, 'secret');
  assert.strictEqual(result['API_KEY'].comment, 'my secret');
});

test('parseEnvFile handles empty values', () => {
  const content = 'EMPTY_KEY=\n';
  const result = scanner.parseEnvFile(content);
  assert.strictEqual(result['EMPTY_KEY'].hasValue, false);
});

test('parseEnvFile handles empty content', () => {
  assert.deepStrictEqual(scanner.parseEnvFile(''), {});
});

test('parseEnvFile ignores lowercase keys', () => {
  const content = 'lowercase_key=value\nAPI_KEY=secret\n';
  const result = scanner.parseEnvFile(content);
  assert.ok(!result['lowercase_key']);
  assert.ok(result['API_KEY']);
});

// --- generateEnvExample tests ---

test('generateEnvExample produces sorted output', () => {
  const scannedVars = {
    ZEBRA: { files: [{ relativePath: 'a.js', line: 1 }], count: 1 },
    ALPHA: { files: [{ relativePath: 'b.js', line: 2 }], count: 1 },
    MIKE: { files: [{ relativePath: 'c.js', line: 3 }], count: 1 },
  };
  const output = scanner.generateEnvExample(scannedVars, { includeComments: false });
  const lines = output.split('\n');
  const alphaIdx = lines.findIndex(l => l.startsWith('ALPHA='));
  const mikeIdx = lines.findIndex(l => l.startsWith('MIKE='));
  const zebraIdx = lines.findIndex(l => l.startsWith('ZEBRA='));
  assert.ok(alphaIdx < mikeIdx);
  assert.ok(mikeIdx < zebraIdx);
});

test('generateEnvExample includes header', () => {
  const output = scanner.generateEnvExample({ FOO: { files: [], count: 1 } });
  assert.ok(output.includes('Environment Variables'));
  assert.ok(output.includes('Env Sync'));
});

test('generateEnvExample includes file comments when enabled', () => {
  const scannedVars = {
    API_KEY: { files: [{ relativePath: 'src/app.js', line: 42 }], count: 1 },
  };
  const output = scanner.generateEnvExample(scannedVars, { includeComments: true });
  assert.ok(output.includes('src/app.js:42'));
});

test('generateEnvExample excludes file comments when disabled', () => {
  const scannedVars = {
    API_KEY: { files: [{ relativePath: 'src/app.js', line: 42 }], count: 1 },
  };
  const output = scanner.generateEnvExample(scannedVars, { includeComments: false });
  assert.ok(!output.includes('src/app.js'));
});

test('generateEnvExample handles empty input', () => {
  const output = scanner.generateEnvExample({});
  assert.ok(output.includes('No environment variables'));
});

test('generateEnvExample shows file count for multi-file vars', () => {
  const scannedVars = {
    API_KEY: {
      files: [
        { relativePath: 'a.js', line: 1 },
        { relativePath: 'b.js', line: 2 },
        { relativePath: 'c.js', line: 3 },
      ],
      count: 3,
    },
  };
  const output = scanner.generateEnvExample(scannedVars, { includeComments: true });
  assert.ok(output.includes('3 files'));
});

test('generateEnvExample preserves existing values', () => {
  const scannedVars = {
    API_KEY: { files: [], count: 1 },
  };
  const existingValues = {
    API_KEY: { value: 'existing_secret', hasValue: true },
  };
  const output = scanner.generateEnvExample(scannedVars, {
    includeComments: false,
    existingValues,
  });
  assert.ok(output.includes('API_KEY=existing_secret'));
});

// --- diffEnvFiles tests ---

test('diffEnvFiles finds missing vars', () => {
  const scanned = { API_KEY: {}, DB_URL: {}, REDIS: {} };
  const example = { API_KEY: {}, DB_URL: {} };
  const diff = scanner.diffEnvFiles(scanned, example);
  assert.deepStrictEqual(diff.missing, ['REDIS']);
  assert.deepStrictEqual(diff.extra, []);
});

test('diffEnvFiles finds extra vars', () => {
  const scanned = { API_KEY: {} };
  const example = { API_KEY: {}, OLD_KEY: {}, DEPRECATED: {} };
  const diff = scanner.diffEnvFiles(scanned, example);
  assert.deepStrictEqual(diff.missing, []);
  assert.deepStrictEqual(diff.extra, ['DEPRECATED', 'OLD_KEY']);
});

test('diffEnvFiles handles perfect match', () => {
  const scanned = { A: {}, B: {} };
  const example = { A: {}, B: {} };
  const diff = scanner.diffEnvFiles(scanned, example);
  assert.deepStrictEqual(diff.missing, []);
  assert.deepStrictEqual(diff.extra, []);
});

test('diffEnvFiles handles empty inputs', () => {
  const diff = scanner.diffEnvFiles({}, {});
  assert.deepStrictEqual(diff.missing, []);
  assert.deepStrictEqual(diff.extra, []);
});

test('diffEnvFiles sorts results alphabetically', () => {
  const scanned = { Z: {}, A: {}, M: {} };
  const example = {};
  const diff = scanner.diffEnvFiles(scanned, example);
  assert.deepStrictEqual(diff.missing, ['A', 'M', 'Z']);
});

// --- Default constants ---

test('DEFAULT_EXTENSIONS includes common languages', () => {
  assert.ok(scanner.DEFAULT_EXTENSIONS.includes('.js'));
  assert.ok(scanner.DEFAULT_EXTENSIONS.includes('.ts'));
  assert.ok(scanner.DEFAULT_EXTENSIONS.includes('.py'));
  assert.ok(scanner.DEFAULT_EXTENSIONS.includes('.go'));
});

test('DEFAULT_EXCLUDE_DIRS includes node_modules and .git', () => {
  assert.ok(scanner.DEFAULT_EXCLUDE_DIRS.includes('node_modules'));
  assert.ok(scanner.DEFAULT_EXCLUDE_DIRS.includes('.git'));
});
