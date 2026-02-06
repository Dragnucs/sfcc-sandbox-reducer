/**
 * Streaming XML writer - optimized for performance
 * Fixed: properly handle self-closing tags via closetag events
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import sax from 'sax';

const HIGH_WATER_MARK = 256 * 1024;

// Elements that contain product-id attribute to filter
const FILTERABLE = new Set([
    'product',
    'price-table',
    'record',
    'category-assignment',
]);

// Deprecated elements to remove from output (SFCC warnings)
// Also remove allocation-timestamp - it's optional and causes "48 hour past limit" errors
const DEPRECATED = new Set([
    'store-non-inventory-flag',
    'store-non-revenue-flag',
    'store-non-discountable-flag',
    'store-force-price-flag',
    'allocation-timestamp',
]);

/**
 * Write a reduced file, keeping only products in the filter set
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {Set<string>} keepProducts
 * @returns {Promise<{kept: number, removed: number}>}
 */
export async function writeReducedFile(inputPath, outputPath, keepProducts) {
    await mkdir(dirname(outputPath), { recursive: true });

    return new Promise((resolve, reject) => {
        let kept = 0;
        let removed = 0;
        let skipDepth = 0;
        let currentDepth = 0;
        let inSkipped = false;
        let inDeprecated = false;
        let deprecatedDepth = 0;

        // Track open tags to know if we need to close them
        const openTags = [];

        const output = createWriteStream(outputPath, {
            highWaterMark: HIGH_WATER_MARK,
        });
        const parser = sax.createStream(true, { trim: false, position: false });

        // Buffer writes for performance
        let buffer = '';
        const BUFFER_SIZE = 64 * 1024;

        const flush = () => {
            if (buffer) {
                output.write(buffer);
                buffer = '';
            }
        };

        const write = (s) => {
            buffer += s;
            if (buffer.length >= BUFFER_SIZE) flush();
        };

        // Fast XML escaping - only escape what's necessary
        const escapeXml = (s) => {
            if (!s) return '';
            return s
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        };

        const escapeAttr = (s) => {
            if (!s) return '';
            return s
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        };

        const attrsToString = (attrs) => {
            let s = '';
            for (const k in attrs) {
                s += ` ${k}="${escapeAttr(attrs[k])}"`;
            }
            return s;
        };

        parser.on('xmldecl', (decl) => {
            let s = '<?xml';
            if (decl.version) s += ` version="${decl.version}"`;
            if (decl.encoding) s += ` encoding="${decl.encoding}"`;
            if (decl.standalone) s += ` standalone="${decl.standalone}"`;
            s += '?>';
            write(s);
        });

        parser.on('processinginstruction', (pi) => {
            write(`<?${pi.name} ${pi.body}?>`);
        });

        parser.on('doctype', (doctype) => {
            write(`<!DOCTYPE ${doctype}>`);
        });

        parser.on('opentag', (node) => {
            currentDepth++;

            if (inSkipped || inDeprecated) return;

            // Check if this element should be filtered
            if (FILTERABLE.has(node.name)) {
                const pid = node.attributes['product-id'];
                if (pid && !keepProducts.has(pid)) {
                    inSkipped = true;
                    skipDepth = currentDepth;
                    removed++;
                    return;
                }
                kept++;
            }

            // Skip deprecated elements
            if (DEPRECATED.has(node.name)) {
                inDeprecated = true;
                deprecatedDepth = currentDepth;
                return;
            }

            // Always write as opening tag, closetag event will close it
            write(`<${node.name}${attrsToString(node.attributes)}>`);
            openTags.push(node.name);
        });

        parser.on('closetag', (name) => {
            if (inSkipped) {
                if (currentDepth === skipDepth) {
                    inSkipped = false;
                    skipDepth = 0;
                }
            } else if (inDeprecated) {
                if (currentDepth === deprecatedDepth) {
                    inDeprecated = false;
                    deprecatedDepth = 0;
                }
            } else {
                write(`</${name}>`);
                openTags.pop();
            }
            currentDepth--;
        });

        parser.on('text', (text) => {
            if (!inSkipped && !inDeprecated) write(escapeXml(text));
        });

        parser.on('cdata', (cdata) => {
            if (!inSkipped && !inDeprecated) write(`<![CDATA[${cdata}]]>`);
        });

        parser.on('comment', (comment) => {
            if (!inSkipped) write(`<!--${comment}-->`);
        });

        parser.on('end', () => {
            flush();
            output.end(() => resolve({ kept, removed }));
        });

        parser.on('error', (err) => {
            output.destroy();
            reject(new Error(`XML error in ${inputPath}: ${err.message}`));
        });

        output.on('error', reject);

        const input = createReadStream(inputPath, {
            highWaterMark: HIGH_WATER_MARK,
        });
        input.on('error', reject);
        input.pipe(parser);
    });
}
