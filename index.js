#!/usr/bin/env node
/**
 * SFCC Sandbox Reducer CLI
 * High-performance catalog reducer and image downloader for SFCC sandboxes
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import downloadImagesCommand from './commands/download-images.js';
import initCommand from './commands/init.js';
import reduceCommand from './commands/reduce.js';

yargs(hideBin(process.argv))
    .scriptName('sfcc-sandbox-reducer')
    .usage('$0 <command> [options]')
    .command(initCommand)
    .command(reduceCommand)
    .command(downloadImagesCommand)
    .demandCommand(1, 'You must specify a command')
    .option('verbose', {
        alias: 'V',
        type: 'boolean',
        description: 'Enable verbose logging',
    })
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version')
    .epilogue('For more information, see the README')
    .parse();
