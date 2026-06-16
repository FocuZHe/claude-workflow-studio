// Test setup — redirects ALL test data to a temp directory
// so tests never pollute the production data/ directory.
// Each worker thread gets its own subdirectory to avoid conflicts.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Some legacy tests call require.resolve() for source .ts files only to clear
// caches. Registering the extension lets Node resolve those paths without
// changing runtime imports, which still use compiled dist files.
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = function (_module, filename) {
    throw new Error(`Direct requiring TypeScript source is not supported in tests: ${filename}`);
  };
}

const baseDir = path.join(__dirname, '.temp-data');

// Unique subdirectory per worker/process to prevent cross-test file corruption
const workerId = process.env.TEST_WORKER_ID
  || process.env.NODE_WORKER_ID
  || process.pid.toString();
const uniqueDir = path.join(baseDir, workerId);

// Clean previous run for this specific worker
if (fs.existsSync(uniqueDir)) {
  fs.rmSync(uniqueDir, { recursive: true, force: true });
}
fs.mkdirSync(uniqueDir, { recursive: true });

// Must be set BEFORE any module loads config.js
process.env.DATA_DIR = uniqueDir;
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Use random available port to avoid conflicts

// Also ensure workspace root doesn't interfere
process.env.WORKSPACE_ROOT = path.join(uniqueDir, 'test-workspace');
