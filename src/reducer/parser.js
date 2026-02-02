/**
 * High-performance streaming XML parser for SFCC files
 * Optimized for speed - minimal allocations, no fancy features
 */

import { createReadStream } from 'node:fs';
import sax from 'sax';

const HIGH_WATER_MARK = 256 * 1024; // 256KB chunks for faster I/O

/**
 * Extract product IDs from elements with product-id attribute
 * @param {string} path - File path
 * @param {string} elementName - Element name to look for (e.g., 'record', 'price-table')
 * @returns {Promise<Set<string>>}
 */
export function extractProductIds(path, elementName) {
    return new Promise((resolve, reject) => {
        const products = new Set();
        const parser = sax.createStream(true, { trim: true, position: false });

        parser.on('opentag', (node) => {
            if (node.name === elementName) {
                const pid = node.attributes['product-id'];
                if (pid) products.add(pid);
            }
        });

        parser.on('end', () => resolve(products));
        parser.on('error', reject);

        const stream = createReadStream(path, {
            highWaterMark: HIGH_WATER_MARK,
        });
        stream.on('error', reject);
        stream.pipe(parser);
    });
}

/**
 * Extract products from navigation catalog (category-assignment elements)
 * @param {string} path
 * @returns {Promise<Set<string>>}
 */
export function extractNavigationProducts(path) {
    return new Promise((resolve, reject) => {
        const products = new Set();
        const parser = sax.createStream(true, { trim: true, position: false });

        parser.on('opentag', (node) => {
            if (node.name === 'category-assignment') {
                const pid = node.attributes['product-id'];
                if (pid) products.add(pid);
            }
        });

        parser.on('end', () => resolve(products));
        parser.on('error', reject);

        const stream = createReadStream(path, {
            highWaterMark: HIGH_WATER_MARK,
        });
        stream.on('error', reject);
        stream.pipe(parser);
    });
}

/**
 * Extract online products and master->variant relationships from master catalog
 * Also tracks variation-groups which are used in navigation catalogs
 * @param {string} path
 * @param {string[]} siteIds - Site IDs to check for online status
 * @returns {Promise<{total: number, online: Set<string>, masterVariants: Map<string, string[]>, variationGroups: Map<string, string>}>}
 */
export function extractOnlineProducts(path, siteIds = []) {
    return new Promise((resolve, reject) => {
        const online = new Set();
        const masterVariants = new Map();
        const variationGroups = new Map(); // variation-group-id -> master-id
        let total = 0;

        // State
        let inProduct = false;
        let currentProductId = null;
        let currentOnlineFlag = null;
        const currentSiteFlags = new Map();
        let currentVariants = [];
        let currentVariationGroups = [];

        let inOnlineFlag = false;
        let currentSiteId = null;
        let inVariants = false;
        let inVariationGroups = false;
        let textBuffer = '';

        const parser = sax.createStream(true, { trim: true, position: false });

        parser.on('opentag', (node) => {
            switch (node.name) {
                case 'product':
                    inProduct = true;
                    currentProductId = node.attributes['product-id'];
                    currentOnlineFlag = null;
                    currentSiteFlags.clear();
                    currentVariants = [];
                    currentVariationGroups = [];
                    total++;
                    break;
                case 'online-flag':
                    if (inProduct) {
                        inOnlineFlag = true;
                        currentSiteId = node.attributes['site-id'] || null;
                        textBuffer = '';
                    }
                    break;
                case 'variants':
                    inVariants = true;
                    break;
                case 'variant':
                    if (inVariants) {
                        const vid = node.attributes['product-id'];
                        if (vid) currentVariants.push(vid);
                    }
                    break;
                case 'variation-groups':
                    inVariationGroups = true;
                    break;
                case 'variation-group':
                    if (inVariationGroups) {
                        const vgid = node.attributes['product-id'];
                        if (vgid) currentVariationGroups.push(vgid);
                    }
                    break;
            }
        });

        parser.on('text', (text) => {
            if (inOnlineFlag) textBuffer += text;
        });

        parser.on('closetag', (name) => {
            switch (name) {
                case 'online-flag':
                    if (inOnlineFlag) {
                        const isOnline =
                            textBuffer.trim().toLowerCase() === 'true';
                        if (currentSiteId) {
                            currentSiteFlags.set(currentSiteId, isOnline);
                        } else {
                            currentOnlineFlag = isOnline;
                        }
                        inOnlineFlag = false;
                        currentSiteId = null;
                    }
                    break;
                case 'variants':
                    inVariants = false;
                    break;
                case 'variation-groups':
                    inVariationGroups = false;
                    break;
                case 'product':
                    if (inProduct && currentProductId) {
                        // Determine online status
                        // First check site-specific flags, then fall back to global flag
                        let isOnline = false;
                        if (
                            siteIds &&
                            siteIds.length > 0 &&
                            currentSiteFlags.size > 0
                        ) {
                            // Check site-specific flags if they exist
                            for (const sid of siteIds) {
                                if (currentSiteFlags.get(sid) === true) {
                                    isOnline = true;
                                    break;
                                }
                            }
                        } else {
                            // No site-specific flags found, use global online-flag
                            isOnline = currentOnlineFlag === true;
                        }

                        if (isOnline) {
                            online.add(currentProductId);
                        }

                        if (currentVariants.length > 0) {
                            masterVariants.set(
                                currentProductId,
                                currentVariants,
                            );
                        }

                        // Track variation-group -> master relationship
                        for (const vgid of currentVariationGroups) {
                            variationGroups.set(vgid, currentProductId);
                        }
                    }
                    inProduct = false;
                    currentProductId = null;
                    break;
            }
        });

        parser.on('end', () =>
            resolve({ total, online, masterVariants, variationGroups }),
        );
        parser.on('error', reject);

        const stream = createReadStream(path, {
            highWaterMark: HIGH_WATER_MARK,
        });
        stream.on('error', reject);
        stream.pipe(parser);
    });
}

/**
 * Extract product category assignments from navigation catalogs
 * @param {string} path
 * @returns {Promise<Map<string, string[]>>} Map of product-id -> [category-ids]
 */
export function extractProductCategories(path) {
    return new Promise((resolve, reject) => {
        const productCategories = new Map();
        const parser = sax.createStream(true, { trim: true, position: false });

        parser.on('opentag', (node) => {
            if (node.name === 'category-assignment') {
                const pid = node.attributes['product-id'];
                const cid = node.attributes['category-id'];
                if (pid && cid) {
                    if (!productCategories.has(pid)) {
                        productCategories.set(pid, []);
                    }
                    productCategories.get(pid).push(cid);
                }
            }
        });

        parser.on('end', () => resolve(productCategories));
        parser.on('error', reject);

        const stream = createReadStream(path, {
            highWaterMark: HIGH_WATER_MARK,
        });
        stream.on('error', reject);
        stream.pipe(parser);
    });
}
