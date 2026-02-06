/**
 * Reduce Command
 * High-performance SFCC catalog reducer for sandbox optimization
 */

import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { CatalogReducer } from '../lib/reducer.js';

export default {
    command: 'reduce',
    aliases: ['r'],
    desc: 'Reduce SFCC catalogs, pricebooks, and inventories',
    builder: (yargs) => {
        return yargs
            .option('config', {
                alias: 'c',
                type: 'string',
                description: 'Path to configuration file',
                default: 'reducer-config.json',
            })
            .option('output', {
                alias: 'o',
                type: 'string',
                description: 'Output directory for reduced files',
                default: 'output',
            })
            .option('dry-run', {
                type: 'boolean',
                default: false,
                description: "Analyze only, don't write files",
            });
    },
    handler: async (argv) => {
        const startTime = Date.now();
        console.log('SFCC Catalog Reducer');
        console.log('='.repeat(50));

        try {
            const configPath = path.resolve(process.cwd(), argv.config);
            const config = await loadConfig(configPath);
            console.log(`[OK] Loaded configuration from ${argv.config}`);

            const reducer = new CatalogReducer(config, argv.output, {
                verbose: argv.verbose,
                dryRun: argv.dryRun,
            });

            // Phase 1: Collect product IDs from all sources
            await reducer.collectProductIds();

            // Phase 2: Reduce all files
            if (!argv.dryRun) {
                await reducer.reduceAll();
            } else {
                console.log('\n[DRY RUN] No files written');
            }

            reducer.printSummary();

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`\n[DONE] Total processing time: ${elapsed}s`);
        } catch (error) {
            console.error(`\n[ERROR] ${error.message}`);
            if (argv.verbose) console.error(error.stack);
            process.exit(1);
        }
    },
};
