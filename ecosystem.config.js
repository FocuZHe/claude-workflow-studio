const path = require('path');

module.exports = {
  apps: [
    {
      name: 'claude-console',
      script: path.join(__dirname, 'src/server/app.js'),
      // PATH is inherited from the system environment; only set if you need
      // to add extra directories (e.g. env: { PATH: process.env.PATH + ':/extra' })
    }
  ]
};
