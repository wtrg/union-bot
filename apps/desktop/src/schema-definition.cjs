/**
 * @file schema-definition.cjs (desktop export)
 * @description Single source of truth for desktop Electron SQLite schema and migrations (UB-P2-R04-01).
 */

const path = require('node:path');

let schema;
try {
  schema = require('../../storage/src/schema-definition.cjs');
} catch {
  schema = require(path.resolve(__dirname, '../../../packages/storage/src/schema-definition.cjs'));
}

module.exports = schema;
