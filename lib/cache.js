/**
 * Cache module for storing product ID sets between runs
 * Uses file modification times to invalidate cache
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const CACHE_DIR = '.reducer-cache';
const CACHE_VERSION = '1';

/**
 * Generate a cache key based on file paths and their modification times
 * @param {string[]} files
 * @returns {Promise<string>}
 */
async function generateCacheKey(files) {
    const parts = [CACHE_VERSION];

    for (const file of files.sort()) {
        try {
            const s = await stat(file);
            parts.push(`${file}:${s.mtimeMs}`);
        } catch {
            parts.push(`${file}:missing`);
        }
    }

    const hash = createHash('md5').update(parts.join('|')).digest('hex');
    return hash.substring(0, 16);
}

/**
 * Get cached product IDs if available and valid
 * @param {string} basePath
 * @param {string} cacheKey
 * @param {string} setName
 * @returns {Promise<Set<string>|null>}
 */
export async function getCachedSet(basePath, cacheKey, setName) {
    try {
        const cachePath = resolve(
            basePath,
            CACHE_DIR,
            `${setName}-${cacheKey}.json`,
        );
        const content = await readFile(cachePath, 'utf-8');
        const data = JSON.parse(content);
        return new Set(data);
    } catch {
        return null;
    }
}

/**
 * Save product IDs to cache
 * @param {string} basePath
 * @param {string} cacheKey
 * @param {string} setName
 * @param {Set<string>} productSet
 */
export async function saveCachedSet(basePath, cacheKey, setName, productSet) {
    try {
        const cacheDir = resolve(basePath, CACHE_DIR);
        await mkdir(cacheDir, { recursive: true });
        const cachePath = resolve(cacheDir, `${setName}-${cacheKey}.json`);
        await writeFile(cachePath, JSON.stringify([...productSet]));
    } catch (e) {
        // Ignore cache write errors
    }
}

/**
 * Get cached master catalog analysis
 * @param {string} basePath
 * @param {string} cacheKey
 * @returns {Promise<{online: Set<string>, masterVariants: Map<string, string[]>, total: number}|null>}
 */
export async function getCachedMasterAnalysis(basePath, cacheKey) {
    try {
        const cachePath = resolve(
            basePath,
            CACHE_DIR,
            `master-${cacheKey}.json`,
        );
        const content = await readFile(cachePath, 'utf-8');
        const data = JSON.parse(content);
        return {
            online: new Set(data.online),
            masterVariants: new Map(data.masterVariants),
            total: data.total,
        };
    } catch {
        return null;
    }
}

/**
 * Save master catalog analysis to cache
 * @param {string} basePath
 * @param {string} cacheKey
 * @param {{online: Set<string>, masterVariants: Map<string, string[]>, total: number}} analysis
 */
export async function saveCachedMasterAnalysis(basePath, cacheKey, analysis) {
    try {
        const cacheDir = resolve(basePath, CACHE_DIR);
        await mkdir(cacheDir, { recursive: true });
        const cachePath = resolve(cacheDir, `master-${cacheKey}.json`);
        const data = {
            online: [...analysis.online],
            masterVariants: [...analysis.masterVariants],
            total: analysis.total,
        };
        await writeFile(cachePath, JSON.stringify(data));
    } catch (e) {
        // Ignore cache write errors
    }
}

/**
 * Generate cache key for a set of files
 */
export { generateCacheKey };
