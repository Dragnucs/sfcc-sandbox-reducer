#!/usr/bin/env node

/**
 * SFCC Image Downloader - Downloads product images from SFCC WebDAV
 *
 * Downloads images for products in a specified navigation category
 * from the SFCC sandbox WebDAV.
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Configuration
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY) || 10;

// Read credentials from dw.json
let username;
let password;
let WEBDAV_BASE;
let masterCatalogName;

try {
    const dwConfig = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'dw.json'), 'utf8'),
    );
    username = dwConfig.username;
    password = dwConfig.password;
} catch (err) {
    console.error(
        'Error: Could not read dw.json. Make sure it exists in the current directory.',
    );
    console.error('Expected format: { "username": "...", "password": "..." }');
    process.exit(1);
}

// Read config from reducer-config.json
try {
    const reducerConfig = JSON.parse(
        fs.readFileSync(
            path.join(process.cwd(), 'reducer-config.json'),
            'utf8',
        ),
    );
    WEBDAV_BASE = reducerConfig.webdav_base;

    // Extract master catalog name from config path (e.g., "./catalogs/BRAND_master/catalog.xml" -> "BRAND_master")
    const masterCatalogPath = reducerConfig.input?.master_catalog || '';
    const match = masterCatalogPath.match(/catalogs\/([^/]+)\//);
    masterCatalogName = match ? match[1] : null;
} catch (err) {
    console.error(
        'Error: Could not read reducer-config.json. Make sure it exists in the current directory.',
    );
    console.error(
        'Expected format: { "webdav_base": "...", "input": { "master_catalog": "..." } }',
    );
    process.exit(1);
}

if (!WEBDAV_BASE) {
    console.error('Error: webdav_base not found in reducer-config.json');
    process.exit(1);
}

if (!masterCatalogName) {
    console.error(
        'Error: Could not determine master catalog name from reducer-config.json',
    );
    console.error(
        'Make sure input.master_catalog is set (e.g., "./catalogs/BRAND_master/catalog.xml")',
    );
    process.exit(1);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function ask(question) {
    return new Promise((resolve) => rl.question(question, resolve));
}

function getAvailableNavigationCatalogs() {
    const outputCatalogsDir = path.join(process.cwd(), 'output', 'catalogs');
    try {
        return fs
            .readdirSync(outputCatalogsDir)
            .filter((name) => name.includes('navigation'))
            .sort();
    } catch {
        return [];
    }
}

function getAllDescendantCategories(content, categoryId) {
    // Build parent->children map
    const categoryRegex =
        /<category\s+category-id="([^"]+)"[^>]*>[\s\S]*?<parent>([^<]+)<\/parent>/g;
    const childrenMap = new Map();

    for (const match of content.matchAll(categoryRegex)) {
        const childId = match[1];
        const parentId = match[2].trim();

        if (!childrenMap.has(parentId)) {
            childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId).push(childId);
    }

    // BFS to find all descendants
    const descendants = new Set([categoryId]);
    const queue = [categoryId];

    while (queue.length > 0) {
        const current = queue.shift();
        const children = childrenMap.get(current) || [];

        for (const child of children) {
            if (!descendants.has(child)) {
                descendants.add(child);
                queue.push(child);
            }
        }
    }

    return descendants;
}

function getCategoryProductsFromCatalog(catalogName, categoryId) {
    const catalogPath = path.join(
        process.cwd(),
        'output',
        'catalogs',
        catalogName,
        'catalog.xml',
    );

    if (!fs.existsSync(catalogPath)) {
        console.error(`Catalog file not found: ${catalogPath}`);
        return { products: [], categories: [] };
    }

    const content = fs.readFileSync(catalogPath, 'utf8');

    // Find all descendant categories (including the category itself)
    const categoryIds = getAllDescendantCategories(content, categoryId);
    console.log(
        `  Found ${categoryIds.size} categories (including descendants)`,
    );

    // Find products in all these categories
    const products = new Set();

    for (const catId of categoryIds) {
        const regex = new RegExp(
            `<category-assignment\\s+category-id="${catId}"\\s+product-id="([^"]+)"`,
            'g',
        );
        for (const match of content.matchAll(regex)) {
            products.add(match[1]);
        }
    }

    return {
        products: Array.from(products),
        categories: Array.from(categoryIds),
    };
}

function deriveMasterProductId(variantId) {
    // Variant IDs are typically longer than master IDs
    // This logic may need to be customized per implementation
    // Default: 7 chars -> 5 chars (remove last 2 digits)
    if (variantId.length === 7) {
        return variantId.slice(0, 5);
    }
    // Already a master product or other format
    return variantId;
}

function getImagePathsForProducts(productIds) {
    const masterCatalogPath = path.join(
        process.cwd(),
        'output',
        'catalogs',
        masterCatalogName,
        'catalog.xml',
    );

    if (!fs.existsSync(masterCatalogPath)) {
        console.error(`Master catalog not found: ${masterCatalogPath}`);
        return [];
    }

    const content = fs.readFileSync(masterCatalogPath, 'utf8');
    const imagePaths = new Set();

    // Derive master product IDs from variant IDs
    const masterIds = new Set();
    for (const productId of productIds) {
        masterIds.add(deriveMasterProductId(productId));
        masterIds.add(productId);
    }

    console.log(
        `Derived ${masterIds.size} unique master product IDs from ${productIds.length} variants`,
    );

    for (const productId of masterIds) {
        const productRegex = new RegExp(
            `<product\\s+product-id="${productId}"[^>]*>([\\s\\S]*?)</product>`,
            'g',
        );

        for (const productMatch of content.matchAll(productRegex)) {
            const productXml = productMatch[1];

            const imageRegex = /<image\s+path="([^"]+)"/g;
            for (const imageMatch of productXml.matchAll(imageRegex)) {
                imagePaths.add(imageMatch[1]);
            }
        }
    }

    return Array.from(imagePaths);
}

// Create a persistent HTTPS agent for connection reuse
const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 20,
    keepAliveMsecs: 30000,
});

function downloadFile(imageUrl, destPath) {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${username}:${password}`).toString('base64');

        const urlObj = new URL(imageUrl);
        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname,
            method: 'GET',
            agent: agent,
            headers: {
                Authorization: `Basic ${auth}`,
                Connection: 'keep-alive',
            },
        };

        const req = https.request(options, (res) => {
            if (res.statusCode === 404) {
                resolve({ success: false, status: 404, message: 'Not found' });
                return;
            }

            if (res.statusCode !== 200) {
                resolve({
                    success: false,
                    status: res.statusCode,
                    message: `HTTP ${res.statusCode}`,
                });
                return;
            }

            fs.mkdirSync(path.dirname(destPath), { recursive: true });

            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                resolve({ success: true });
            });

            fileStream.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function downloadImages(imagePaths, outputDir) {
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let completed = 0;

    console.log(`\nDownloading ${imagePaths.length} images to ${outputDir}...`);
    console.log(`Using ${CONCURRENCY} parallel connections\n`);

    fs.mkdirSync(outputDir, { recursive: true });

    // Filter out already existing files first
    const toDownload = [];
    for (const imagePath of imagePaths) {
        const destPath = path.join(outputDir, imagePath);
        if (fs.existsSync(destPath)) {
            skipped++;
        } else {
            toDownload.push(imagePath);
        }
    }

    console.log(`Skipping ${skipped} already downloaded images`);
    console.log(`Downloading ${toDownload.length} new images...\n`);

    if (toDownload.length === 0) {
        console.log('All images already downloaded!');
        return;
    }

    const startTime = Date.now();

    async function processBatch(batch) {
        return Promise.all(
            batch.map(async (imagePath) => {
                const imageUrl = `${WEBDAV_BASE}/${imagePath}`;
                const destPath = path.join(outputDir, imagePath);

                try {
                    const result = await downloadFile(imageUrl, destPath);
                    completed++;

                    if (result.success) {
                        downloaded++;
                    } else {
                        failed++;
                    }

                    const elapsed = (Date.now() - startTime) / 1000;
                    const rate = completed / elapsed;
                    const eta = Math.round(
                        (toDownload.length - completed) / rate,
                    );
                    process.stdout.write(
                        `\r[${completed}/${toDownload.length}] ${downloaded} OK, ${failed} failed | ${rate.toFixed(1)}/s | ETA: ${eta}s`.padEnd(
                            80,
                        ),
                    );
                } catch (err) {
                    completed++;
                    failed++;
                }
            }),
        );
    }

    for (let i = 0; i < toDownload.length; i += CONCURRENCY) {
        const batch = toDownload.slice(i, i + CONCURRENCY);
        await processBatch(batch);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n');
    console.log('='.repeat(50));
    console.log(`Download complete in ${totalTime}s`);
    console.log(`  Downloaded: ${downloaded}`);
    console.log(`  Skipped (already exists): ${skipped}`);
    console.log(`  Failed: ${failed}`);
    console.log('='.repeat(50));
}

async function main() {
    console.log('='.repeat(50));
    console.log('SFCC Image Downloader');
    console.log('='.repeat(50));
    console.log(`\nWebDAV Base: ${WEBDAV_BASE}`);
    console.log(`Master Catalog: ${masterCatalogName}`);
    console.log(`Username: ${username}\n`);

    const catalogs = getAvailableNavigationCatalogs();

    if (catalogs.length === 0) {
        console.error('No navigation catalogs found in output/catalogs/');
        console.error('Run the reducer first to generate output catalogs.');
        rl.close();
        return;
    }

    console.log('Available navigation catalogs:');
    catalogs.forEach((cat, idx) => {
        console.log(`  ${idx + 1}. ${cat}`);
    });

    const catalogChoice = await ask('\nSelect catalog (number): ');
    const catalogIndex = Number.parseInt(catalogChoice) - 1;

    if (
        Number.isNaN(catalogIndex) ||
        catalogIndex < 0 ||
        catalogIndex >= catalogs.length
    ) {
        console.error('Invalid selection');
        rl.close();
        return;
    }

    const selectedCatalog = catalogs[catalogIndex];
    console.log(`\nSelected: ${selectedCatalog}`);

    const categoryId = await ask('\nEnter category ID: ');

    if (!categoryId.trim()) {
        console.error('Category ID is required');
        rl.close();
        return;
    }

    console.log(`\nFinding products in category "${categoryId}"...`);

    const result = getCategoryProductsFromCatalog(
        selectedCatalog,
        categoryId.trim(),
    );
    const products = result.products;

    if (products.length === 0) {
        console.log(
            `No products found in category "${categoryId}" or its descendants`,
        );
        console.log(
            `  Searched in ${result.categories.length} categories: ${result.categories.slice(0, 5).join(', ')}${result.categories.length > 5 ? '...' : ''}`,
        );
        rl.close();
        return;
    }

    console.log(
        `Found ${products.length} products across ${result.categories.length} categories`,
    );
    console.log(
        `Sample products: ${products.slice(0, 5).join(', ')}${products.length > 5 ? '...' : ''}`,
    );

    console.log('\nLooking up images in master catalog...');

    const imagePaths = getImagePathsForProducts(products);

    if (imagePaths.length === 0) {
        console.log('No images found for these products in master catalog');
        rl.close();
        return;
    }

    console.log(`Found ${imagePaths.length} unique images`);
    console.log(
        `Sample images: ${imagePaths.slice(0, 3).join(', ')}${imagePaths.length > 3 ? '...' : ''}`,
    );

    const outputDir = path.join(process.cwd(), 'downloaded-images');

    const confirm = await ask(
        `\nProceed to download ${imagePaths.length} images? (y/n): `,
    );

    if (confirm.toLowerCase() !== 'y') {
        console.log('Cancelled');
        rl.close();
        return;
    }

    await downloadImages(imagePaths, outputDir);

    rl.close();
}

main().catch((err) => {
    console.error('Error:', err);
    rl.close();
    process.exit(1);
});
