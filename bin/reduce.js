#!/usr/bin/env node
/**
 * SFCC Reduce - Shortcut for 'sfcc-sandbox-reducer reduce'
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, '..', 'index.js');

spawn('node', [cli, 'reduce', ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd(),
}).on('exit', (code) => process.exit(code ?? 0));
