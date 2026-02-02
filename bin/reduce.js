#!/usr/bin/env node

/**
 * SFCC Catalog Reducer - High-performance catalog reduction for SFCC sandboxes
 *
 * Filters products based on:
 * - Online status (online-flag)
 * - Presence in navigation catalogs
 * - Presence in pricebooks
 * - Presence in inventories
 */

import { program } from 'commander';
import { loadConfig } from '../src/reducer/config.js';
import { CatalogReducer } from '../src/reducer/reducer.js';

program
    .name('sfcc-reduce')
    .description(
        'High-performance SFCC catalog reducer for sandbox optimization',
    )
    .version('1.0.0')
    .option(
        '-c, --config <path>',
        'Path to configuration file',
        'reducer-config.json',
    )
    .option(
        '-o, --output <path>',
        'Output directory for reduced files',
        'output',
    )
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--dry-run', "Analyze only, don't write files")
    .parse();

const options = program.opts();

async function main() {
    const startTime = Date.now();
    console.log('SFCC Catalog Reducer v1.0.0');
    console.log('='.repeat(50));

    try {
        const config = await loadConfig(options.config);
        console.log(`[OK] Loaded configuration from ${options.config}`);

        const reducer = new CatalogReducer(config, options.output, {
            verbose: options.verbose,
            dryRun: options.dryRun,
        });

        // Phase 1: Collect product IDs from all sources
        await reducer.collectProductIds();

        // Phase 2: Reduce all files
        if (!options.dryRun) {
            await reducer.reduceAll();
        } else {
            console.log('\n[DRY RUN] No files written');
        }

        reducer.printSummary();

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n[DONE] Total processing time: ${elapsed}s`);
    } catch (error) {
        console.error(`\n[ERROR] ${error.message}`);
        if (options.verbose) console.error(error.stack);
        process.exit(1);
    }
}

main();
