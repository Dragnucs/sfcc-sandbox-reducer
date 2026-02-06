#!/usr/bin/env node
import { spawn } from 'node:child_process';
/**
 * SFCC Init - Shortcut for 'sfcc-sandbox-reducer init'
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, '..', 'index.js');

spawn('node', [cli, 'init', ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd(),
}).on('exit', (code) => process.exit(code ?? 0));
