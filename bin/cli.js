#!/usr/bin/env node
const path = require('path');

function printHelp() {
  console.log(`Claude Workflow Studio

Usage:
  claude-workflow-studio [options]
  multi-agent-platform [options]

Options:
  -p, --port <port>   Web server port (default: 3000)
      --host <host>   Bind host (default: 127.0.0.1; use 0.0.0.0 for LAN access)
  -h, --help          Show this help

Examples:
  claude-workflow-studio
  claude-workflow-studio --port 3001
  npm start -- --port 3001
`);
}

function readValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    console.error(`Missing value for ${name}`);
    process.exit(1);
  }
  return value;
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];

  if (arg === '-h' || arg === '--help') {
    printHelp();
    process.exit(0);
  }

  if (arg === '-p' || arg === '--port') {
    process.env.PORT = readValue(args, i, arg);
    i += 1;
    continue;
  }

  if (arg.startsWith('--port=')) {
    process.env.PORT = arg.slice('--port='.length);
    continue;
  }

  if (arg === '--host') {
    process.env.HOST = readValue(args, i, arg);
    i += 1;
    continue;
  }

  if (arg.startsWith('--host=')) {
    process.env.HOST = arg.slice('--host='.length);
    continue;
  }

  console.error(`Unknown option: ${arg}`);
  console.error('Run with --help for usage.');
  process.exit(1);
}

if (process.env.PORT) {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port: ${process.env.PORT}`);
    process.exit(1);
  }
}

// 切换到项目根目录，确保 data/、logs/ 等相对路径正确解析
// 注意：这会影响整个进程的 cwd，所有 process.cwd() 调用将返回项目根目录
process.chdir(path.join(__dirname, '..'));
require('../dist/server/app.js');
