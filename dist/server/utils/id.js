"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const uuid_1 = require("uuid");
/**
 * Generate a UUID v4
 * @returns UUID string
 */
function generateId() {
    return (0, uuid_1.v4)();
}
module.exports = { generateId };
//# sourceMappingURL=id.js.map