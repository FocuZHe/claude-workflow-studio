const path = require('path');

module.exports = {
  apps: [
    {
      name: 'claude-console',
      // 指向编译产物 dist/server/app.js（需先 npm run build）
      // 原路径 src/server/app.js 不存在，TS 源码需编译后才能运行
      script: path.join(__dirname, 'dist/server/app.js'),
      // PATH is inherited from the system environment; only set if you need
      // to add extra directories (e.g. env: { PATH: process.env.PATH + ':/extra' })
    }
  ]
};
