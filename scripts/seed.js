#!/usr/bin/env node
// Generates a one-off SQL insert from seed-state.json and runs it against
// the D1 database via wrangler. Run with --remote (production) or --local
// (wrangler's local dev SQLite copy). Only ever run once, on first setup --
// running it again would stomp on live picks/results, since it always
// writes row id=1.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const mode = process.argv.includes('--local') ? '--local' : '--remote';

const seedPath = path.join(__dirname, '..', 'seed-state.json');
const state = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const json = JSON.stringify(state).replace(/'/g, "''");
const updatedAt = state.updatedAt || new Date().toISOString();

const sql = `INSERT INTO state (id, json, updated_at) VALUES (1, '${json}', '${updatedAt}')
  ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at;`;

const tmpFile = path.join(__dirname, '..', '.seed.tmp.sql');
fs.writeFileSync(tmpFile, sql);

try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'sec-pickem-db', mode, '--file=' + tmpFile], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  console.log('Seeded state (' + mode + ').');
} finally {
  fs.unlinkSync(tmpFile);
}
