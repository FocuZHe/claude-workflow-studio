module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests/frontend'],
  testMatch: ['**/*.test.js'],
  setupFiles: ['<rootDir>/tests/frontend/setup.js'],
  moduleFileExtensions: ['js', 'json'],
  transform: {},
};
