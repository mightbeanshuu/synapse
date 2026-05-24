#!/usr/bin/env node
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const entry  = path.join(__dirname, '..', 'src', 'index.ts');
const tsxBin = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx');

const result = spawnSync(tsxBin, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 0);
