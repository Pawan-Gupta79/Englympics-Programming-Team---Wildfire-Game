// scripts/simulate.js
// Usage: node scripts/simulate.js test_state.json
const fs = require('fs');
const { decide } = require('../src/agent');

const path = process.argv[2] || 'test_state.json';
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
const out = decide(state);
console.log(JSON.stringify(out, null, 2));
