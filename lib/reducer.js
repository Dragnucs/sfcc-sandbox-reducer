/**
 * Main reducer orchestration
 */

import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { glob } from 'glob';
import {
    generateCacheKey,
    getCachedMasterAnalysis,
    getCachedSet,
    saveCachedMasterAnalysis,
    saveCachedSet,
} from './cache.js';
import {
    extractNavigationProducts,
    extractOnlineProducts,
    extractProductCategories,
    extractProductIds,
} from './parser.js';
import { writeReducedFile } from './writer.js';

/**
 * Main reducer that orchestrates the entire process
 */
export class CatalogReducer {
    constructor(config, outputDir, options = {}) {
        this.config = config;
        this.outputDir = resolve(process.cwd(), outputDir);
        this.options = options;
        this.resolvedFiles = null;
        this.basePath = process.cwd();

        // Product ID sets for filtering
        this.onlineProducts = new Set(); // Products with online-flag=true
        this.navigationProducts = new Set(); // Products in navigation catalogs
        this.pricebookProducts = new Set(); // Products with price records
        this.inventoryProducts = new Set(); // Products with inventory records
        this.keepProducts = new Set(); // Final set of products to keep
        this.masterVariantsMap = new Map(); // Master -> variant relationships
        this.variationGroupMap = new Map(); // Variation-group -> master relationship

        // Stats
        this.stats = {
            totalMasterProducts: 0,
            onlineProducts: 0,
            inNavigation: 0,
            inPricebooks: 0,
            inInventory: 0,
            finalKept: 0,
            filesProcessed: 0,
            recordsKept: 0,
            recordsRemoved: 0,
            originalSize: 0,
            reducedSize: 0,
            cacheHits: 0,
        };
    }

    /**
     * Phase 1: Collect product IDs from all sources
     */
    async collectProductIds() {
        console.log('\n[PHASE 1] Collecting product IDs...');
        const start = Date.now();

        // Resolve file patterns
        this.resolvedFiles = await this.resolveFiles();

        const totalFiles =
            this.resolvedFiles.masterCatalogs.length +
            this.resolvedFiles.navigationCatalogs.length +
            this.resolvedFiles.inventories.length +
            this.resolvedFiles.pricebooks.length;

        console.log(`  Found ${totalFiles} files`);

        // Generate cache keys for each file group
        const masterCacheKey = await generateCacheKey(
            this.resolvedFiles.masterCatalogs,
        );
        const navCacheKey = await generateCacheKey(
            this.resolvedFiles.navigationCatalogs,
        );
        const priceCacheKey = await generateCacheKey(
            this.resolvedFiles.pricebooks,
        );
        const invCacheKey = await generateCacheKey(
            this.resolvedFiles.inventories,
        );

        // 1. Extract online products from master catalog
        console.log('  Scanning master catalogs...');

        // Try cache first
        const cachedMaster = await getCachedMasterAnalysis(
            this.basePath,
            masterCacheKey,
        );
        if (cachedMaster) {
            console.log('    [CACHE HIT] Using cached master analysis');
            this.onlineProducts = cachedMaster.online;
            this.masterVariantsMap = cachedMaster.masterVariants;
            this.variationGroupMap = cachedMaster.variationGroups || new Map();
            this.stats.totalMasterProducts = cachedMaster.total;
            this.stats.cacheHits++;
        } else {
            for (const path of this.resolvedFiles.masterCatalogs) {
                const size = await this.getFileSize(path);
                console.log(`    ${basename(path)} (${this.formatSize(size)})`);

                const result = await extractOnlineProducts(
                    path,
                    this.config.filters.site_ids,
                );
                this.stats.totalMasterProducts += result.total;

                for (const id of result.online) {
                    this.onlineProducts.add(id);
                }

                // Track master->variant relationships
                for (const [masterId, variants] of result.masterVariants) {
                    this.masterVariantsMap.set(masterId, variants);
                }

                // Track variation-group -> master relationships
                for (const [vgId, masterId] of result.variationGroups) {
                    this.variationGroupMap.set(vgId, masterId);
                }
            }
            // Save to cache
            await saveCachedMasterAnalysis(this.basePath, masterCacheKey, {
                online: this.onlineProducts,
                masterVariants: this.masterVariantsMap,
                variationGroups: this.variationGroupMap,
                total: this.stats.totalMasterProducts,
            });
        }

        // Calculate original size for master catalogs
        for (const path of this.resolvedFiles.masterCatalogs) {
            this.stats.originalSize += await this.getFileSize(path);
        }

        this.stats.onlineProducts = this.onlineProducts.size;
        console.log(
            `    -> ${this.onlineProducts.size} online products (masters + variants)`,
        );
        console.log(
            `    -> ${this.masterVariantsMap.size} master products with variants`,
        );
        console.log(`    -> ${this.variationGroupMap.size} variation groups`);

        // 2. Extract products from navigation catalogs
        console.log('  Scanning navigation catalogs...');
        const cachedNav = await getCachedSet(
            this.basePath,
            navCacheKey,
            'navigation',
        );
        if (cachedNav) {
            console.log('    [CACHE HIT] Using cached navigation products');
            this.navigationProducts = cachedNav;
            this.stats.cacheHits++;
        } else {
            for (const path of this.resolvedFiles.navigationCatalogs) {
                const products = await extractNavigationProducts(path);
                for (const id of products) {
                    this.navigationProducts.add(id);
                }
            }
            await saveCachedSet(
                this.basePath,
                navCacheKey,
                'navigation',
                this.navigationProducts,
            );
        }
        for (const path of this.resolvedFiles.navigationCatalogs) {
            this.stats.originalSize += await this.getFileSize(path);
        }
        this.stats.inNavigation = this.navigationProducts.size;
        console.log(
            `    -> ${this.navigationProducts.size} products in navigation`,
        );

        // 3. Extract products from pricebooks
        console.log('  Scanning pricebooks...');
        const cachedPrices = await getCachedSet(
            this.basePath,
            priceCacheKey,
            'pricebooks',
        );
        if (cachedPrices) {
            console.log('    [CACHE HIT] Using cached pricebook products');
            this.pricebookProducts = cachedPrices;
            this.stats.cacheHits++;
        } else {
            for (const path of this.resolvedFiles.pricebooks) {
                const products = await extractProductIds(path, 'price-table');
                for (const id of products) {
                    this.pricebookProducts.add(id);
                }
            }
            await saveCachedSet(
                this.basePath,
                priceCacheKey,
                'pricebooks',
                this.pricebookProducts,
            );
        }
        for (const path of this.resolvedFiles.pricebooks) {
            this.stats.originalSize += await this.getFileSize(path);
        }
        this.stats.inPricebooks = this.pricebookProducts.size;
        console.log(
            `    -> ${this.pricebookProducts.size} products with prices`,
        );

        // 4. Extract products from inventories
        console.log('  Scanning inventories...');
        const cachedInv = await getCachedSet(
            this.basePath,
            invCacheKey,
            'inventories',
        );
        if (cachedInv) {
            console.log('    [CACHE HIT] Using cached inventory products');
            this.inventoryProducts = cachedInv;
            this.stats.cacheHits++;
        } else {
            for (const path of this.resolvedFiles.inventories) {
                const products = await extractProductIds(path, 'record');
                for (const id of products) {
                    this.inventoryProducts.add(id);
                }
            }
            await saveCachedSet(
                this.basePath,
                invCacheKey,
                'inventories',
                this.inventoryProducts,
            );
        }
        for (const path of this.resolvedFiles.inventories) {
            this.stats.originalSize += await this.getFileSize(path);
        }
        this.stats.inInventory = this.inventoryProducts.size;
        console.log(
            `    -> ${this.inventoryProducts.size} products with inventory records`,
        );

        // 5. Compute final product set using PRODUCT GROUP logic
        // A product group = master + its variants
        // SFCC Product Structure:
        // - Navigation catalogs assign categories to VARIATION-GROUPS (these appear in PLPs)
        // - Variation-groups belong to MASTERs
        // - Masters have VARIANTS (the actual sellable SKUs)
        // - Pricebooks and Inventories reference VARIANTS (not masters or variation-groups)
        //
        // Keep a product group if:
        //   - It has at least one variation-group with category assignment in navigation
        //   - At least one variant has BOTH price AND inventory
        // Then keep: master + variation-groups with categories + qualifying variants
        console.log('  Computing product groups...');

        let keptGroups = 0;
        let removedGroups = 0;
        const removalReasons = {
            notInNavigation: 0,
            noVariantWithPrice: 0,
            noVariantWithInventory: 0,
            noQualifiedVariants: 0,
        };

        // Build set of variation-groups that have category assignments (visible in navigation)
        const navigationVariationGroups = new Set();
        for (const navProductId of this.navigationProducts) {
            if (this.variationGroupMap.has(navProductId)) {
                navigationVariationGroups.add(navProductId);
            }
        }
        console.log(
            `    -> ${navigationVariationGroups.size} variation-groups with navigation categories`,
        );

        // Build map of master -> variation-groups that are in navigation
        const masterNavigationVGs = new Map(); // masterId -> [variation-group-ids in navigation]
        for (const vgId of navigationVariationGroups) {
            const masterId = this.variationGroupMap.get(vgId);
            if (masterId) {
                if (!masterNavigationVGs.has(masterId)) {
                    masterNavigationVGs.set(masterId, []);
                }
                masterNavigationVGs.get(masterId).push(vgId);
            }
        }
        console.log(
            `    -> ${masterNavigationVGs.size} masters have variation-groups in navigation`,
        );

        // Process masters that have variation-groups in navigation
        for (const [masterId, navVGs] of masterNavigationVGs) {
            const variants = this.masterVariantsMap.get(masterId);

            if (!variants || variants.length === 0) {
                removalReasons.noQualifiedVariants++;
                removedGroups++;
                continue;
            }

            // Check variants for price and inventory
            let hasVariantWithPrice = false;
            let hasVariantWithInventory = false;
            const qualifiedVariants = [];

            for (const variantId of variants) {
                const hasPrice = this.pricebookProducts.has(variantId);
                const hasInventory = this.inventoryProducts.has(variantId);

                if (hasPrice) hasVariantWithPrice = true;
                if (hasInventory) hasVariantWithInventory = true;

                // Keep variant if it has both price and inventory
                if (hasPrice && hasInventory) {
                    qualifiedVariants.push(variantId);
                }
            }

            // Check: At least one variant must have price
            if (!hasVariantWithPrice) {
                removalReasons.noVariantWithPrice++;
                removedGroups++;
                continue;
            }

            // Check: At least one variant must have inventory record
            if (!hasVariantWithInventory) {
                removalReasons.noVariantWithInventory++;
                removedGroups++;
                continue;
            }

            // Check: At least one variant qualifies (has both)
            if (qualifiedVariants.length === 0) {
                removalReasons.noQualifiedVariants++;
                removedGroups++;
                continue;
            }

            // Product group qualifies!
            // Keep: master + navigation variation-groups + qualified variants
            this.keepProducts.add(masterId);

            for (const vgId of navVGs) {
                this.keepProducts.add(vgId);
            }

            for (const v of qualifiedVariants) {
                this.keepProducts.add(v);
            }

            keptGroups++;
        }

        // Also handle standalone products (products without master/variant hierarchy)
        // These might be simple products that are directly in navigation
        let standaloneKept = 0;
        let standaloneRemoved = 0;

        // Build sets for quick lookup
        const allMasterIds = new Set(this.masterVariantsMap.keys());
        const allVariantIds = new Set();
        for (const variants of this.masterVariantsMap.values()) {
            for (const v of variants) allVariantIds.add(v);
        }
        const allVGIds = new Set(this.variationGroupMap.keys());

        // Check navigation products that aren't variation-groups
        for (const navProductId of this.navigationProducts) {
            if (
                allMasterIds.has(navProductId) ||
                allVariantIds.has(navProductId) ||
                allVGIds.has(navProductId)
            ) {
                continue; // Part of a product group, already handled
            }
            if (this.keepProducts.has(navProductId)) continue; // Already added

            // Standalone product - must have price and inventory
            if (
                this.pricebookProducts.has(navProductId) &&
                this.inventoryProducts.has(navProductId)
            ) {
                this.keepProducts.add(navProductId);
                standaloneKept++;
            } else {
                standaloneRemoved++;
            }
        }

        console.log(
            `    -> ${keptGroups} product groups kept, ${removedGroups} removed`,
        );
        console.log(
            `    -> ${standaloneKept} standalone products kept, ${standaloneRemoved} removed`,
        );
        console.log('    Removal reasons:');
        console.log(
            `       No variation-group in navigation: ${removalReasons.notInNavigation}`,
        );
        console.log(
            `       No variant with price: ${removalReasons.noVariantWithPrice}`,
        );
        console.log(
            `       No variant with inventory: ${removalReasons.noVariantWithInventory}`,
        );
        console.log(
            `       No qualified variants (need both): ${removalReasons.noQualifiedVariants}`,
        );

        // Add explicit keep products
        for (const id of this.config.filters.keep_product_ids || []) {
            this.keepProducts.add(id);
        }

        // Apply max_products limit if specified
        if (
            this.config.filters.max_products &&
            this.keepProducts.size > this.config.filters.max_products
        ) {
            await this.applyProportionalReduction(
                this.config.filters.max_products,
            );
        }

        this.stats.finalKept = this.keepProducts.size;

        const elapsed = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`\n[OK] Phase 1 complete in ${elapsed}s`);
        console.log(
            `  Keeping ${this.keepProducts.size} products (${this.getReductionPercent()}% reduction)`,
        );
    }

    /**
     * Apply proportional reduction across categories to meet max_products limit
     * This works at the PRODUCT GROUP level (master + variants + variation-groups)
     * Categories are derived from variation-groups in navigation catalogs
     * @param {number} maxProducts - Target number of products to keep
     */
    async applyProportionalReduction(maxProducts) {
        console.log(
            `\n  Applying proportional reduction to ${maxProducts} products...`,
        );

        const currentCount = this.keepProducts.size;
        const reductionPercent = (
            ((currentCount - maxProducts) / currentCount) *
            100
        ).toFixed(1);
        console.log(
            `    Need to reduce by ${reductionPercent}% (${currentCount} -> ${maxProducts})`,
        );

        // Step 1: Build category assignments from navigation catalogs
        // Navigation catalogs assign categories to VARIATION-GROUPS
        const variationGroupCategories = new Map(); // vgId -> [categoryIds]

        for (const path of this.resolvedFiles.navigationCatalogs) {
            const categories = await extractProductCategories(path);
            for (const [pid, cids] of categories) {
                // Check if this is a variation-group
                if (this.variationGroupMap.has(pid)) {
                    variationGroupCategories.set(pid, cids);
                }
            }
        }

        // Step 2: Build master -> categories mapping via variation-groups
        // A master's categories are the categories of all its variation-groups
        const masterCategories = new Map(); // masterId -> Set<categoryId>

        for (const [vgId, masterId] of this.variationGroupMap) {
            if (!this.keepProducts.has(masterId)) continue;

            const vgCats = variationGroupCategories.get(vgId);
            if (vgCats && vgCats.length > 0) {
                if (!masterCategories.has(masterId)) {
                    masterCategories.set(masterId, new Set());
                }
                for (const cid of vgCats) {
                    masterCategories.get(masterId).add(cid);
                }
            }
        }

        // Step 3: Build product groups (master + qualified variants + variation-groups)
        const productGroups = new Map(); // masterId -> { variants: [], vgs: [], categories: [], size: number }

        for (const [masterId, allVariants] of this.masterVariantsMap) {
            if (!this.keepProducts.has(masterId)) continue;

            const qualifiedVariants = allVariants.filter((v) =>
                this.keepProducts.has(v),
            );
            if (qualifiedVariants.length === 0) continue;

            // Find variation-groups for this master
            const vgs = [];
            for (const [vgId, mId] of this.variationGroupMap) {
                if (mId === masterId && this.keepProducts.has(vgId)) {
                    vgs.push(vgId);
                }
            }

            const cats = masterCategories.get(masterId);

            productGroups.set(masterId, {
                variants: qualifiedVariants,
                vgs: vgs,
                categories: cats ? Array.from(cats) : [],
                size: 1 + qualifiedVariants.length + vgs.length, // master + variants + vgs
            });
        }

        // Step 4: Group product groups by their PRIMARY category
        const categoryGroups = new Map(); // categoryId -> [masterId]
        const uncategorizedGroups = []; // masters with no categories

        for (const [masterId, group] of productGroups) {
            if (group.categories.length > 0) {
                const primaryCat = group.categories[0];
                if (!categoryGroups.has(primaryCat)) {
                    categoryGroups.set(primaryCat, []);
                }
                categoryGroups.get(primaryCat).push(masterId);
            } else {
                uncategorizedGroups.push(masterId);
            }
        }

        // Count total product group entries
        let totalGroupProducts = 0;
        for (const group of productGroups.values()) {
            totalGroupProducts += group.size;
        }

        console.log(
            `    Found ${productGroups.size} product groups (${totalGroupProducts} products)`,
        );
        console.log(
            `    ${categoryGroups.size} categories, ${uncategorizedGroups.length} uncategorized groups`,
        );

        // Step 5: Calculate target groups per category (proportional distribution)
        // We work in terms of PRODUCT GROUPS, not individual products
        const totalGroups = productGroups.size;

        // Estimate average group size to calculate target groups
        const avgGroupSize = totalGroupProducts / totalGroups;
        const targetGroups = Math.floor(maxProducts / avgGroupSize);

        console.log(
            `    Avg group size: ${avgGroupSize.toFixed(1)}, targeting ~${targetGroups} groups`,
        );

        // Calculate products per category (for proportional distribution)
        const categoryProductCounts = new Map();
        for (const [cid, masters] of categoryGroups) {
            let count = 0;
            for (const masterId of masters) {
                count += productGroups.get(masterId).size;
            }
            categoryProductCounts.set(cid, count);
        }

        let uncategorizedProductCount = 0;
        for (const masterId of uncategorizedGroups) {
            uncategorizedProductCount += productGroups.get(masterId).size;
        }

        // Distribute target products proportionally across categories
        const categoryTargets = new Map(); // categoryId -> target product count
        let allocatedProducts = 0;

        // Reserve slots for uncategorized (proportional)
        const uncategorizedTarget = Math.floor(
            (uncategorizedProductCount / totalGroupProducts) * maxProducts,
        );

        // Distribute remaining to categories
        const remainingSlots = maxProducts - uncategorizedTarget;
        const categorizedProductCount =
            totalGroupProducts - uncategorizedProductCount;

        for (const [cid, count] of categoryProductCounts) {
            const categoryRatio = count / categorizedProductCount;
            const target = Math.floor(categoryRatio * remainingSlots);
            categoryTargets.set(cid, target);
            allocatedProducts += target;
        }

        // Step 6: Select product groups to keep from each category
        const newKeepSet = new Set();

        // Helper to add entire product group
        const addProductGroup = (masterId) => {
            const group = productGroups.get(masterId);
            if (!group) return 0;

            newKeepSet.add(masterId);
            for (const v of group.variants) {
                newKeepSet.add(v);
            }
            for (const vg of group.vgs) {
                newKeepSet.add(vg);
            }
            return group.size;
        };

        // Select from each category
        for (const [cid, masters] of categoryGroups) {
            const target = categoryTargets.get(cid) || 0;
            let kept = 0;

            // Sort by group size (smaller first to maximize diversity)
            const sortedMasters = [...masters].sort(
                (a, b) => productGroups.get(a).size - productGroups.get(b).size,
            );

            for (const masterId of sortedMasters) {
                if (kept >= target) break;
                const group = productGroups.get(masterId);

                // Add if we have room or this is the first group
                if (kept + group.size <= target || kept === 0) {
                    kept += addProductGroup(masterId);
                }
            }
        }

        // Select from uncategorized
        let uncatKept = 0;
        const sortedUncategorized = [...uncategorizedGroups].sort(
            (a, b) => productGroups.get(a).size - productGroups.get(b).size,
        );

        for (const masterId of sortedUncategorized) {
            if (uncatKept >= uncategorizedTarget) break;
            const group = productGroups.get(masterId);

            if (
                uncatKept + group.size <= uncategorizedTarget ||
                uncatKept === 0
            ) {
                uncatKept += addProductGroup(masterId);
            }
        }

        // Also add standalone products (not part of master/variant hierarchy)
        // These are products that qualify but aren't in productGroups
        for (const pid of this.keepProducts) {
            if (newKeepSet.size >= maxProducts) break;
            if (newKeepSet.has(pid)) continue;

            // Check if this is a standalone product (has price + inventory, not in any product group)
            const isMaster = this.masterVariantsMap.has(pid);
            const isVariant = Array.from(this.masterVariantsMap.values()).some(
                (variants) => variants.includes(pid),
            );
            const isVariationGroup = this.variationGroupMap.has(pid);

            if (!isMaster && !isVariant && !isVariationGroup) {
                if (
                    this.pricebookProducts.has(pid) &&
                    this.inventoryProducts.has(pid)
                ) {
                    newKeepSet.add(pid);
                }
            }
        }

        // Update keepProducts
        const beforeSize = this.keepProducts.size;
        this.keepProducts = newKeepSet;
        const afterSize = this.keepProducts.size;

        console.log(`    Reduced from ${beforeSize} to ${afterSize} products`);
        console.log(
            `    Actual reduction: ${(((beforeSize - afterSize) / beforeSize) * 100).toFixed(1)}%`,
        );
    }

    /**
     * Phase 2: Reduce all files
     */
    async reduceAll() {
        console.log('\n[PHASE 2] Reducing files...');
        const start = Date.now();

        // Process all file types
        await this.processFileGroup(
            this.resolvedFiles.masterCatalogs,
            'catalogs',
            'Master catalogs',
        );
        await this.processFileGroup(
            this.resolvedFiles.navigationCatalogs,
            'catalogs',
            'Navigation catalogs',
        );
        await this.processFileGroup(
            this.resolvedFiles.inventories,
            'inventory-lists',
            'Inventories',
        );
        await this.processFileGroup(
            this.resolvedFiles.pricebooks,
            'pricebooks',
            'Pricebooks',
        );

        const elapsed = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`\n[OK] Phase 2 complete in ${elapsed}s`);
    }

    async processFileGroup(files, subdir, label) {
        if (files.length === 0) return;

        process.stdout.write(`  ${label}: `);
        let groupKept = 0;
        let groupRemoved = 0;

        for (let i = 0; i < files.length; i++) {
            const inputPath = files[i];
            const outputPath = this.getOutputPath(inputPath, subdir);

            try {
                const result = await writeReducedFile(
                    inputPath,
                    outputPath,
                    this.keepProducts,
                );
                groupKept += result.kept;
                groupRemoved += result.removed;
                this.stats.filesProcessed++;

                const outSize = await this.getFileSize(outputPath);
                this.stats.reducedSize += outSize;

                process.stdout.write('.');
            } catch (error) {
                process.stdout.write('X');
                if (this.options.verbose) {
                    console.error(`\n    Error: ${error.message}`);
                }
            }
        }

        this.stats.recordsKept += groupKept;
        this.stats.recordsRemoved += groupRemoved;
        console.log(` ${groupKept} kept, ${groupRemoved} removed`);
    }

    getOutputPath(inputPath, subdir) {
        const basePath = process.cwd();
        const relativePath = inputPath
            .replace(basePath, '')
            .replace(/^[\\/]+/, '');
        const parts = relativePath.split(/[\\/]/);

        // For catalogs: catalogs/PB_master/catalog.xml -> output/catalogs/PB_master/catalog.xml
        // For inventories: inventory-lists/file.xml -> output/inventory-lists/file.xml
        // For pricebooks: pricebooks/file.xml -> output/pricebooks/file.xml

        if (parts.length >= 3 && parts[0] === 'catalogs') {
            // Keep subfolder structure for catalogs
            const parentFolder = parts[parts.length - 2];
            const fileName = parts[parts.length - 1];
            return resolve(this.outputDir, subdir, parentFolder, fileName);
        }

        // For flat directories, just use the filename
        return resolve(this.outputDir, subdir, basename(inputPath));
    }

    async resolveFiles() {
        const basePath = process.cwd();

        const resolvePatterns = async (patterns) => {
            const files = [];
            for (const pattern of patterns || []) {
                const fullPattern = resolve(basePath, pattern);
                const matches = await glob(fullPattern, {
                    windowsPathsNoEscape: true,
                });
                files.push(...matches);
            }
            return files;
        };

        return {
            masterCatalogs: await resolvePatterns(
                this.config.sources.master_catalogs,
            ),
            navigationCatalogs: await resolvePatterns(
                this.config.sources.navigation_catalogs,
            ),
            inventories: await resolvePatterns(this.config.sources.inventories),
            pricebooks: await resolvePatterns(this.config.sources.pricebooks),
        };
    }

    async getFileSize(path) {
        try {
            const s = await stat(path);
            return s.size;
        } catch {
            return 0;
        }
    }

    formatSize(bytes) {
        if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
        if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${bytes} B`;
    }

    getReductionPercent() {
        if (this.stats.totalMasterProducts === 0) return 0;
        return (
            (1 - this.keepProducts.size / this.stats.totalMasterProducts) *
            100
        ).toFixed(1);
    }

    printSummary() {
        console.log(`\n${'='.repeat(50)}`);
        console.log('REDUCTION SUMMARY');
        console.log('='.repeat(50));

        if (this.stats.cacheHits > 0) {
            console.log(
                `\nCache: ${this.stats.cacheHits} cache hits (faster run)`,
            );
        }

        console.log('\nProduct Filtering:');
        console.log(
            `  Total in master catalog:  ${this.stats.totalMasterProducts}`,
        );
        console.log(`  Online products:          ${this.stats.onlineProducts}`);
        console.log(`  In navigation catalogs:   ${this.stats.inNavigation}`);
        console.log(`  With price records:       ${this.stats.inPricebooks}`);
        console.log(`  With inventory records:   ${this.stats.inInventory}`);
        console.log(`  Final kept (intersection): ${this.stats.finalKept}`);

        console.log('\nFile Statistics:');
        console.log(`  Files processed:    ${this.stats.filesProcessed}`);
        console.log(`  Records kept:       ${this.stats.recordsKept}`);
        console.log(`  Records removed:    ${this.stats.recordsRemoved}`);

        console.log('\nSize Reduction:');
        console.log(
            `  Original size:  ${this.formatSize(this.stats.originalSize)}`,
        );
        console.log(
            `  Reduced size:   ${this.formatSize(this.stats.reducedSize)}`,
        );
        console.log(
            `  Saved:          ${this.formatSize(this.stats.originalSize - this.stats.reducedSize)} (${this.getSizeReductionPercent()}%)`,
        );
    }

    getSizeReductionPercent() {
        if (this.stats.originalSize === 0) return 0;
        return (
            (1 - this.stats.reducedSize / this.stats.originalSize) *
            100
        ).toFixed(1);
    }
}
