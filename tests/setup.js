// Test setup — redirects ALL test data to a temp directory
// so tests never pollute the production data/ directory.
// Each worker thread gets its own subdirectory to avoid conflicts.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

// Also ensure workspace root doesn't interfere
process.env.WORKSPACE_ROOT = path.join(uniqueDir, 'test-workspace');
