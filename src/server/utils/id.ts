import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a UUID v4
 * @returns UUID string
 */
function generateId(): string {
  return uuidv4();
}

module.exports = { generateId };
