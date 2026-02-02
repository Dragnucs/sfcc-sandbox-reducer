# SFCC Sandbox Reducer

High-performance SFCC catalog reducer and image downloader for sandbox optimization. This toolkit analyzes SFCC catalogs, pricebooks, and inventories to create reduced datasets suitable for development and testing sandboxes.

## Features

### Catalog Reducer (`sfcc-reduce`)
- **Streaming XML parsing** - Handles huge files (500MB+) efficiently without loading them into memory
- **Smart dependency resolution** - Keeps master products with their variants and variation groups
- **Site-specific filtering** - Filter by site-specific online flags
- **Proportional reduction** - Limit products while maintaining category distribution
- **Caching** - Faster subsequent runs with file-based caching
- **Progress reporting** - Real-time progress updates

### Image Downloader (`sfcc-download-images`)
- **Interactive category selection** - Browse navigation catalogs and select categories
- **Recursive category traversal** - Downloads images for all products in a category hierarchy
- **Parallel downloads** - Configurable concurrency for fast downloads
- **Resume support** - Skips already downloaded images
- **Connection pooling** - HTTP keep-alive for better performance

## Requirements

- Node.js 18.0.0 or higher
- SFCC WebDAV access credentials

## Installation

### Global Installation (Recommended)

```bash
npm install -g sfcc-sandbox-reducer
```

### Local Installation

```bash
npm install sfcc-sandbox-reducer
```

### From Source

```bash
git clone <repository-url>
cd sfcc-sandbox-reducer
npm install
npm link  # Makes commands available globally
```

## Quick Start

1. **Create configuration files** in your project directory:

```bash
# Copy example configs
cp node_modules/sfcc-sandbox-reducer/examples/reducer-config.example.json reducer-config.json
cp node_modules/sfcc-sandbox-reducer/examples/dw.example.json dw.json
```

2. **Edit the configuration files** with your specific values.

3. **Place your SFCC export files** in the appropriate directories:
   - `input/catalogs/` - Master and navigation catalogs
   - `input/pricebooks/` - Pricebook XML files
   - `input/inventory-lists/` - Inventory XML files

4. **Run the reducer**:

```bash
sfcc-reduce --config reducer-config.json --output output
```

5. **Download images** (optional):

```bash
sfcc-download-images
```

## Configuration

### reducer-config.json

```json
{
  "webdav_base": "https://YOUR-SANDBOX.demandware.net/on/demandware.servlet/webdav/Sites/Catalogs/BRAND_master/default",
  "input": {
    "master_catalog": "./input/catalogs/BRAND_master/catalog.xml",
    "navigation_catalogs": "./input/catalogs/BRAND_*_navigation/catalog.xml",
    "pricebooks": "./input/pricebooks/*.xml",
    "inventories": "./input/inventory-lists/*.xml"
  },
  "output": {
    "directory": "./output"
  },
  "filters": {
    "keep_online_products": true,
    "sites_to_check": ["SITE_FR", "SITE_UK", "SITE_DE"],
    "always_keep": [],
    "always_remove": [],
    "max_products": 10000
  }
}
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `webdav_base` | Base URL for WebDAV image downloads |
| `input.master_catalog` | Path to master catalog (glob pattern) |
| `input.navigation_catalogs` | Path to navigation catalogs (glob pattern) |
| `input.pricebooks` | Path to pricebook files (glob pattern) |
| `input.inventories` | Path to inventory files (glob pattern) |
| `filters.keep_online_products` | Only keep products with online-flag=true |
| `filters.sites_to_check` | Site IDs to check for online status |
| `filters.always_keep` | Product IDs to always keep |
| `filters.always_remove` | Product IDs to always remove |
| `filters.max_products` | Maximum number of products (proportional reduction) |

### dw.json

```json
{
  "username": "your-webdav-username",
  "password": "your-webdav-password"
}
```

## CLI Usage

### Catalog Reducer

```bash
sfcc-reduce [options]

Options:
  -V, --version          Output version number
  -c, --config <path>    Path to configuration file (default: "reducer-config.json")
  -o, --output <path>    Output directory (default: "output")
  -v, --verbose          Enable verbose logging
  --dry-run              Analyze only, don't write files
  -h, --help             Display help
```

### Image Downloader

```bash
sfcc-download-images

# With increased concurrency
CONCURRENCY=20 sfcc-download-images
```

## How It Works

### Reduction Process

1. **Phase 1: Analysis**
   - Parses master catalogs using streaming XML
   - Builds product dependency graph (masters → variants → variation-groups)
   - Identifies online products per site
   - Scans navigation catalogs for category assignments
   - Scans pricebooks and inventories for product presence

2. **Phase 2: Filtering**
   - Keeps products that are:
     - Online (have online-flag=true for specified sites)
     - Have a variation-group assigned to navigation categories
     - Have at least one variant with both price AND inventory
   - Applies proportional reduction if max_products is specified

3. **Phase 3: Output**
   - Writes reduced XML files with only qualifying products
   - Removes deprecated SFCC elements
   - Preserves directory structure

### Product Group Logic

SFCC products have a hierarchical structure:
- **Master Product** - The parent product
- **Variation Groups** - Appear in navigation (PLPs)
- **Variants** - The actual sellable SKUs

The reducer keeps entire product groups where:
- At least one variation-group has a navigation category assignment
- At least one variant has both a price record AND an inventory record

## Example Output

```
SFCC Catalog Reducer v1.0.0
==================================================
[OK] Loaded configuration from reducer-config.json

[PHASE 1] Collecting product IDs...
  Found 15 files
  Scanning master catalogs...
    catalog.xml (450.32 MB)
    -> 50000 online products (masters + variants)
    -> 5000 master products with variants
    -> 2500 variation groups
  Scanning navigation catalogs...
    -> 3000 products in navigation
  Scanning pricebooks...
    -> 45000 products with prices
  Scanning inventories...
    -> 40000 products with inventory records
  Computing product groups...
    -> 2000 product groups kept, 500 removed

[OK] Phase 1 complete in 12.34s
  Keeping 25000 products (50.0% reduction)

[PHASE 2] Reducing files...
  Master catalogs: . 5000 kept, 45000 removed
  Navigation catalogs: ...... 3000 kept, 0 removed
  Inventories: ...... 25000 kept, 15000 removed
  Pricebooks: .......... 25000 kept, 20000 removed

[OK] Phase 2 complete in 45.67s

==================================================
REDUCTION SUMMARY
==================================================
Product Filtering:
  Total in master catalog:  50000
  Online products:          50000
  In navigation catalogs:   3000
  With price records:       45000
  With inventory records:   40000
  Final kept:               25000

File Statistics:
  Files processed:    23
  Records kept:       58000
  Records removed:    80000

Size Reduction:
  Original size:  1.25 GB
  Reduced size:   625.00 MB
  Saved:          625.00 MB (50.0%)

[DONE] Total processing time: 58.01s
```

## Programmatic Usage

```javascript
import { CatalogReducer, loadConfig } from 'sfcc-sandbox-reducer';

const config = await loadConfig('reducer-config.json');
const reducer = new CatalogReducer(config, 'output', { verbose: true });

// Phase 1: Collect and analyze
await reducer.collectProductIds();

// Phase 2: Write reduced files
await reducer.reduceAll();

// Get statistics
reducer.printSummary();
```

## File Structure

```
your-project/
├── dw.json                      # WebDAV credentials (git-ignored)
├── reducer-config.json          # Configuration (git-ignored)
├── input/
│   ├── catalogs/
│   │   ├── BRAND_master/
│   │   │   └── catalog.xml
│   │   ├── BRAND_FR_navigation/
│   │   │   └── catalog.xml
│   │   └── ...
│   ├── inventory-lists/
│   │   └── *.xml
│   └── pricebooks/
│       └── *.xml
├── output/                      # Reduced files (git-ignored)
│   ├── catalogs/
│   ├── inventory-lists/
│   └── pricebooks/
└── downloaded-images/           # Downloaded images (git-ignored)
```

## Tips

- **First run is slower** - Subsequent runs use cached analysis
- **Use `--dry-run`** to preview reduction without writing files
- **Adjust `max_products`** to control output size
- **Check `.reducer-cache/`** if you need to force re-analysis (delete it)

## Troubleshooting

### "No navigation catalogs found"
Make sure you've run the reducer first to generate output catalogs.

### "Could not read dw.json"
Create a `dw.json` file with your WebDAV credentials.

### Memory issues with large files
The tool uses streaming XML parsing, so memory shouldn't be an issue. If you encounter problems, try reducing concurrency: `CONCURRENCY=5 sfcc-download-images`

## License

AGPL-3.0-or-later
