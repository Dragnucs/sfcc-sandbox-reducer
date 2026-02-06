/**
 * Configuration loading and validation
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * @typedef {Object} Sources
 * @property {string[]} master_catalogs - Master catalog file patterns (glob)
 * @property {string[]} navigation_catalogs - Navigation catalog file patterns (glob)
 * @property {string[]} inventories - Inventory file patterns (glob)
 * @property {string[]} pricebooks - Pricebook file patterns (glob)
 */

/**
 * @typedef {Object} Filters
 * @property {boolean} online_only - Only keep products with online-flag = true
 * @property {string[]} site_ids - Site IDs to check for online status
 * @property {boolean} require_category_assignment - Remove products not in any category
 * @property {string[]} keep_product_ids - Products to keep regardless of online status
 * @property {string[]} keep_product_patterns - Product patterns to keep (glob)
 * @property {boolean} remove_zero_inventory - Remove inventory records with zero allocation
 * @property {boolean} remove_expired_prices - Remove expired pricebook entries
 */

/**
 * @typedef {Object} OutputConfig
 * @property {string} suffix - Suffix to add to output files
 * @property {boolean} preserve_structure - Preserve directory structure
 * @property {boolean} pretty_print - Pretty print XML output
 */

/**
 * @typedef {Object} Config
 * @property {Sources} sources
 * @property {Filters} filters
 * @property {OutputConfig} output
 */

const defaultFilters = {
    online_only: true,
    site_ids: [],
    require_category_assignment: false,
    keep_product_ids: [],
    keep_product_patterns: [],
    remove_zero_inventory: false,
    remove_expired_prices: false,
    max_products: null, // Maximum number of products to keep (null = no limit)
};

const defaultOutput = {
    suffix: '_reduced',
    preserve_structure: true,
    pretty_print: false,
};

/**
 * Load and validate configuration from a JSON file
 * @param {string} configPath - Path to the configuration file
 * @returns {Promise<Config>}
 */
export async function loadConfig(configPath) {
    const absolutePath = resolve(process.cwd(), configPath);

    let content;
    try {
        content = await readFile(absolutePath, 'utf-8');
    } catch (error) {
        throw new Error(`Failed to read config file: ${absolutePath}`);
    }

    let config;
    try {
        config = JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to parse config file: ${absolutePath}`);
    }

    // Handle both config formats (reducer-config.json and config.json)
    if (config.input) {
        // Convert from alternative format
        config = {
            sources: {
                master_catalogs: [config.input.master_catalog].filter(Boolean),
                navigation_catalogs: config.input.navigation_catalogs
                    ? [config.input.navigation_catalogs]
                    : [],
                inventories: config.input.inventories
                    ? [config.input.inventories]
                    : [],
                pricebooks: config.input.pricebooks
                    ? [config.input.pricebooks]
                    : [],
            },
            filters: {
                online_only: config.filters?.keep_online_products ?? true,
                site_ids: config.filters?.sites_to_check ?? [],
                keep_product_ids: config.filters?.always_keep ?? [],
                require_category_assignment: false,
                keep_product_patterns: [],
                remove_zero_inventory: false,
                remove_expired_prices: false,
                max_products: config.filters?.max_products ?? null,
            },
            output: {
                suffix: '_reduced',
                preserve_structure: true,
                pretty_print: false,
            },
        };
    }

    // Validate required fields
    if (!config.sources) {
        throw new Error('Config must have a "sources" section');
    }

    // Apply defaults
    config.filters = { ...defaultFilters, ...config.filters };
    config.output = { ...defaultOutput, ...config.output };

    return config;
}
