/**
 * Download Images Command
 * Downloads product images from SFCC WebDAV for specified categories
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import readline from 'node:readline';

// Create a persistent HTTPS agent for connection reuse
const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 20,
    keepAliveMsecs: 30000,
});

/**
 * Load configuration from dw.json and reducer-config.json
 */
function loadConfiguration() {
    let username;
    let password;
    let webdavBase;
    let masterCatalogName;

    try {
        const dwConfig = JSON.parse(
            fs.readFileSync(path.join(process.cwd(), 'dw.json'), 'utf8'),
        );
        username = dwConfig.username;
        password = dwConfig.password;
    } catch {
        throw new Error(
            'Could not read dw.json. Make sure it exists in the current directory.\n' +
                'Expected format: { "username": "...", "password": "..." }',
        );
    }

    try {
        const reducerConfig = JSON.parse(
            fs.readFileSync(
                path.join(process.cwd(), 'reducer-config.json'),
                'utf8',
            ),
        );
        webdavBase = reducerConfig.webdav_base;
        const masterCatalogPath = reducerConfig.input?.master_catalog || '';
        const match = masterCatalogPath.match(/catalogs\/([^/]+)\//);
        masterCatalogName = match ? match[1] : null;
    } catch {
        throw new Error(
            'Could not read reducer-config.json. Make sure it exists in the current directory.\n' +
                'Expected format: { "webdav_base": "...", "input": { "master_catalog": "..." } }',
        );
    }

    if (!webdavBase) {
        throw new Error('webdav_base not found in reducer-config.json');
    }

    if (!masterCatalogName) {
        throw new Error(
            'Could not determine master catalog name from reducer-config.json\n' +
                'Make sure input.master_catalog is set (e.g., "./catalogs/BRAND_master/catalog.xml")',
        );
    }

    return { username, password, webdavBase, masterCatalogName };
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
    const categoryIds = getAllDescendantCategories(content, categoryId);
    console.log(
        `  Found ${categoryIds.size} categories (including descendants)`,
    );

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
    if (variantId.length === 7) {
        return variantId.slice(0, 5);
    }
    return variantId;
}

function getImagePathsForProducts(productIds, masterCatalogName) {
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

function downloadFile(imageUrl, destPath, username, password) {
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

async function downloadImages(
    imagePaths,
    outputDir,
    webdavBase,
    username,
    password,
    concurrency,
) {
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let completed = 0;

    console.log(`\nDownloading ${imagePaths.length} images to ${outputDir}...`);
    console.log(`Using ${concurrency} parallel connections\n`);

    fs.mkdirSync(outputDir, { recursive: true });

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
                const imageUrl = `${webdavBase}/${imagePath}`;
                const destPath = path.join(outputDir, imagePath);

                try {
                    const result = await downloadFile(
                        imageUrl,
                        destPath,
                        username,
                        password,
                    );
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
                } catch {
                    completed++;
                    failed++;
                }
            }),
        );
    }

    for (let i = 0; i < toDownload.length; i += concurrency) {
        const batch = toDownload.slice(i, i + concurrency);
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

export default {
    command: 'download-images',
    aliases: ['dl', 'images'],
    desc: 'Download product images from SFCC WebDAV',
    builder: (yargs) => {
        return yargs
            .option('category', {
                alias: 'c',
                type: 'string',
                description: 'Category ID to download images for',
            })
            .option('catalog', {
                type: 'string',
                description: 'Navigation catalog name',
            })
            .option('output', {
                alias: 'o',
                type: 'string',
                description: 'Output directory for downloaded images',
                default: 'downloaded-images',
            })
            .option('concurrency', {
                type: 'number',
                description: 'Number of parallel downloads',
                default: 10,
            });
    },
    handler: async (argv) => {
        console.log('='.repeat(50));
        console.log('SFCC Image Downloader');
        console.log('='.repeat(50));

        try {
            const config = loadConfiguration();
            console.log(`\nWebDAV Base: ${config.webdavBase}`);
            console.log(`Master Catalog: ${config.masterCatalogName}`);
            console.log(`Username: ${config.username}\n`);

            const catalogs = getAvailableNavigationCatalogs();

            if (catalogs.length === 0) {
                console.error(
                    'No navigation catalogs found in output/catalogs/',
                );
                console.error(
                    'Run the reducer first to generate output catalogs.',
                );
                process.exit(1);
            }

            let selectedCatalog = argv.catalog;
            let categoryId = argv.category;

            // Interactive mode if not all options provided
            if (!selectedCatalog || !categoryId) {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

                const ask = (question) =>
                    new Promise((resolve) => rl.question(question, resolve));

                if (!selectedCatalog) {
                    console.log('Available navigation catalogs:');
                    catalogs.forEach((cat, idx) => {
                        console.log(`  ${idx + 1}. ${cat}`);
                    });

                    const catalogChoice = await ask(
                        '\nSelect catalog (number): ',
                    );
                    const catalogIndex = Number.parseInt(catalogChoice) - 1;

                    if (
                        Number.isNaN(catalogIndex) ||
                        catalogIndex < 0 ||
                        catalogIndex >= catalogs.length
                    ) {
                        console.error('Invalid selection');
                        rl.close();
                        process.exit(1);
                    }

                    selectedCatalog = catalogs[catalogIndex];
                }

                console.log(`\nSelected: ${selectedCatalog}`);

                if (!categoryId) {
                    categoryId = await ask('\nEnter category ID: ');

                    if (!categoryId.trim()) {
                        console.error('Category ID is required');
                        rl.close();
                        process.exit(1);
                    }

                    categoryId = categoryId.trim();
                }

                rl.close();
            }

            console.log(`\nFinding products in category "${categoryId}"...`);

            const result = getCategoryProductsFromCatalog(
                selectedCatalog,
                categoryId,
            );
            const products = result.products;

            if (products.length === 0) {
                console.log(
                    `No products found in category "${categoryId}" or its descendants`,
                );
                console.log(
                    `  Searched in ${result.categories.length} categories: ${result.categories.slice(0, 5).join(', ')}${result.categories.length > 5 ? '...' : ''}`,
                );
                process.exit(0);
            }

            console.log(
                `Found ${products.length} products across ${result.categories.length} categories`,
            );
            console.log(
                `Sample products: ${products.slice(0, 5).join(', ')}${products.length > 5 ? '...' : ''}`,
            );

            console.log('\nLooking up images in master catalog...');

            const imagePaths = getImagePathsForProducts(
                products,
                config.masterCatalogName,
            );

            if (imagePaths.length === 0) {
                console.log(
                    'No images found for these products in master catalog',
                );
                process.exit(0);
            }

            console.log(`Found ${imagePaths.length} unique images`);
            console.log(
                `Sample images: ${imagePaths.slice(0, 3).join(', ')}${imagePaths.length > 3 ? '...' : ''}`,
            );

            const outputDir = path.join(process.cwd(), argv.output);

            await downloadImages(
                imagePaths,
                outputDir,
                config.webdavBase,
                config.username,
                config.password,
                argv.concurrency,
            );
        } catch (error) {
            console.error(`\n[ERROR] ${error.message}`);
            if (argv.verbose) console.error(error.stack);
            process.exit(1);
        }
    },
};
