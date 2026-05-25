#!/usr/bin/env node
const path = require('path');
// Ensure we're in the project root so all relative paths resolve correctly
process.chdir(path.join(__dirname, '..'));
require('../src/server/app.js');
