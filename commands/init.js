/**
 * Init Command
 * Creates configuration files for sfcc-sandbox-reducer
 *
 * Inspired by: biome init, npm init, eslint --init
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const CONFIG_FILE = 'reducer-config.json';
const CREDENTIALS_FILE = 'dw.json';

/**
 * Default configuration template
 */
function getDefaultConfig(options = {}) {
    return {
        webdav_base: options.webdavBase || '',
        input: {
            master_catalog:
                options.masterCatalog || './catalogs/*_master/catalog.xml',
            navigation_catalogs:
                options.navigationCatalogs ||
                './catalogs/*_navigation/catalog.xml',
            pricebooks: options.pricebooks || './pricebooks/*.xml',
            inventories: options.inventories || './inventory-lists/*.xml',
        },
        output: {
            directory: options.outputDir || './output',
        },
        filters: {
            keep_online_products: true,
            sites_to_check: options.sites || [],
            always_keep: [],
            always_remove: [],
            max_products: options.maxProducts || 10000,
        },
    };
}

/**
 * Default credentials template
 */
function getDefaultCredentials(options = {}) {
    return {
        username: options.username || '',
        password: '',
    };
}

/**
 * Build WebDAV base URL from hostname and catalog name
 */
function buildWebdavUrl(hostname, catalogName) {
    // Normalize hostname
    let host = hostname.trim();
    if (!host.startsWith('https://') && !host.startsWith('http://')) {
        host = `https://${host}`;
    }
    // Remove trailing slash
    host = host.replace(/\/+$/, '');

    return `${host}/on/demandware.servlet/webdav/Sites/Catalogs/${catalogName}/default`;
}

/**
 * Auto-detect catalog structure from current directory
 */
function detectCatalogStructure() {
    const detected = {
        masterCatalog: null,
        catalogPrefix: null,
    };

    // Look for common catalog directory patterns
    const catalogDirs = ['catalogs', 'input/catalogs', 'Catalogs'];
    for (const dir of catalogDirs) {
        if (fs.existsSync(dir)) {
            try {
                const entries = fs.readdirSync(dir);
                const masterDir = entries.find(
                    (e) => e.includes('master') || e.includes('Master'),
                );
                if (masterDir) {
                    detected.masterCatalog = `${dir}/${masterDir}/catalog.xml`;
                    // Extract prefix (e.g., "BRAND" from "BRAND_master")
                    const match = masterDir.match(/^(.+?)[-_]?[Mm]aster/);
                    if (match) {
                        detected.catalogPrefix = match[1];
                    }
                }
                break;
            } catch {
                // Continue to next pattern
            }
        }
    }

    return detected;
}

/**
 * Simple readline prompt helper
 */
function createPrompt() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const ask = (question, defaultValue = '') => {
        const prompt = defaultValue
            ? `${question} (${defaultValue}): `
            : `${question}: `;
        return new Promise((resolve) => {
            rl.question(prompt, (answer) => {
                resolve(answer.trim() || defaultValue);
            });
        });
    };

    const confirm = (question, defaultValue = true) => {
        const hint = defaultValue ? '(Y/n)' : '(y/N)';
        return new Promise((resolve) => {
            rl.question(`${question} ${hint}: `, (answer) => {
                const a = answer.trim().toLowerCase();
                if (!a) {
                    resolve(defaultValue);
                } else {
                    resolve(a === 'y' || a === 'yes');
                }
            });
        });
    };

    const close = () => rl.close();

    return { ask, confirm, close };
}

/**
 * Write config file with nice formatting
 */
function writeConfigFile(filePath, config, description) {
    const content = JSON.stringify(config, null, 4);
    fs.writeFileSync(filePath, `${content}\n`, 'utf8');
    console.log(
        `  Created ${filePath} ${description ? `- ${description}` : ''}`,
    );
}

/**
 * Run interactive initialization
 */
async function runInteractive(argv) {
    const prompt = createPrompt();

    console.log(
        '\nThis utility will walk you through creating configuration files.',
    );
    console.log('Press ^C at any time to quit.\n');

    try {
        // Detect existing structure
        const detected = detectCatalogStructure();

        // 1. Sandbox hostname
        const hostname = await prompt.ask(
            'SFCC sandbox hostname (e.g., xxx-001.dx.commercecloud.salesforce.com)',
        );
        if (!hostname) {
            console.log('\nHostname is required. Aborting.');
            prompt.close();
            process.exit(1);
        }

        // 2. Master catalog name
        const defaultCatalog = detected.catalogPrefix
            ? `${detected.catalogPrefix}_master`
            : 'storefront_master';
        const catalogName = await prompt.ask(
            'Master catalog name',
            defaultCatalog,
        );

        // 3. Catalog prefix for patterns
        const prefix =
            detected.catalogPrefix || catalogName.replace(/[-_]?master$/i, '');
        const defaultMasterPath =
            detected.masterCatalog || `./catalogs/${catalogName}/catalog.xml`;
        const masterCatalog = await prompt.ask(
            'Master catalog path',
            defaultMasterPath,
        );

        // 4. Navigation catalogs pattern
        const navigationCatalogs = await prompt.ask(
            'Navigation catalogs pattern',
            `./catalogs/${prefix}*_navigation/catalog.xml`,
        );

        // 5. Sites to check (comma-separated)
        const sitesInput = await prompt.ask(
            'Sites to check for online status (comma-separated)',
            '',
        );
        const sites = sitesInput
            ? sitesInput
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
            : [];

        // 6. Max products
        const maxProductsInput = await prompt.ask(
            'Maximum products to keep',
            '10000',
        );
        const maxProducts = Number.parseInt(maxProductsInput, 10) || 10000;

        // 7. Create dw.json?
        const createCredentials =
            !fs.existsSync(CREDENTIALS_FILE) &&
            (await prompt.confirm(
                '\nCreate dw.json for WebDAV credentials?',
                true,
            ));

        let username = '';
        if (createCredentials) {
            username = await prompt.ask(
                'WebDAV username (leave empty to fill later)',
                '',
            );
            console.log('  Note: Edit dw.json manually to add your password.');
        }

        prompt.close();

        // Build configuration
        const webdavBase = buildWebdavUrl(hostname, catalogName);
        const config = getDefaultConfig({
            webdavBase,
            masterCatalog,
            navigationCatalogs,
            sites,
            maxProducts,
        });

        // Write files
        console.log('\nCreating configuration files...\n');
        writeConfigFile(CONFIG_FILE, config, 'reducer configuration');

        if (createCredentials) {
            writeConfigFile(
                CREDENTIALS_FILE,
                getDefaultCredentials({ username }),
                'WebDAV credentials (add to .gitignore!)',
            );
        }

        // Show next steps
        console.log('\nConfiguration complete!\n');
        console.log('Next steps:');
        if (createCredentials) {
            console.log(`  1. Edit ${CREDENTIALS_FILE} to add your password`);
            console.log(`  2. Add ${CREDENTIALS_FILE} to .gitignore`);
            console.log(
                '  3. Place your SFCC export files in the input directories',
            );
            console.log('  4. Run: sfcc-sandbox-reducer reduce');
        } else {
            console.log(
                '  1. Place your SFCC export files in the input directories',
            );
            console.log('  2. Run: sfcc-sandbox-reducer reduce');
        }
        console.log('');
    } catch (error) {
        prompt.close();
        throw error;
    }
}

/**
 * Run non-interactive initialization with defaults
 */
function runNonInteractive(argv) {
    const config = getDefaultConfig({
        webdavBase: argv.hostname
            ? buildWebdavUrl(argv.hostname, argv.catalog || 'storefront_master')
            : '',
        masterCatalog: argv.masterCatalog,
        navigationCatalogs: argv.navigationCatalogs,
        sites: argv.sites ? argv.sites.split(',').map((s) => s.trim()) : [],
        maxProducts: argv.maxProducts,
    });

    console.log('\nCreating configuration files...\n');
    writeConfigFile(CONFIG_FILE, config, 'reducer configuration');

    if (argv.withCredentials) {
        writeConfigFile(
            CREDENTIALS_FILE,
            getDefaultCredentials(),
            'WebDAV credentials template',
        );
    }

    console.log('\nDone! Edit the configuration files as needed.\n');
}

export default {
    command: 'init',
    aliases: ['i', 'create', 'setup'],
    desc: 'Create configuration files for sfcc-sandbox-reducer',
    builder: (yargs) => {
        return yargs
            .option('yes', {
                alias: 'y',
                type: 'boolean',
                default: false,
                description: 'Skip prompts and use defaults (non-interactive)',
            })
            .option('force', {
                alias: 'f',
                type: 'boolean',
                default: false,
                description: 'Overwrite existing configuration files',
            })
            .option('hostname', {
                type: 'string',
                description: 'SFCC sandbox hostname',
            })
            .option('catalog', {
                type: 'string',
                description: 'Master catalog name',
            })
            .option('sites', {
                type: 'string',
                description: 'Comma-separated list of site IDs',
            })
            .option('max-products', {
                type: 'number',
                default: 10000,
                description: 'Maximum number of products to keep',
            })
            .option('with-credentials', {
                type: 'boolean',
                default: false,
                description: 'Also create dw.json credentials file',
            })
            .example('$0 init', 'Interactive configuration wizard')
            .example('$0 init --yes', 'Create config with defaults')
            .example(
                '$0 init --hostname xxx.dx.commercecloud.salesforce.com --catalog brand_master',
                'Non-interactive with options',
            );
    },
    handler: async (argv) => {
        try {
            // Check for existing files
            const configExists = fs.existsSync(CONFIG_FILE);
            const credentialsExists = fs.existsSync(CREDENTIALS_FILE);

            if (configExists && !argv.force) {
                console.log(`\n${CONFIG_FILE} already exists.`);
                console.log(
                    'Use --force to overwrite existing configuration.\n',
                );
                process.exit(1);
            }

            if (credentialsExists && argv.withCredentials && !argv.force) {
                console.log(`\n${CREDENTIALS_FILE} already exists.`);
                console.log('Use --force to overwrite.\n');
                process.exit(1);
            }

            // Determine mode
            const isInteractive = !argv.yes && process.stdin.isTTY;

            if (isInteractive) {
                await runInteractive(argv);
            } else {
                runNonInteractive(argv);
            }
        } catch (error) {
            console.error(`\n[ERROR] ${error.message}`);
            if (argv.verbose) console.error(error.stack);
            process.exit(1);
        }
    },
};
