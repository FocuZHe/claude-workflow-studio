const { v4: uuidv4 } = require('uuid');

/**
 * Generate a UUID v4
 * @returns {string} UUID string
 */
function generateId() {
  return uuidv4();
}

module.exports = { generateId };
