# MediLedger Web Scraper

A TypeScript-based web scraping project with support for both Puppeteer (for dynamic content) and Cheerio (for static HTML).

## Installation

The project is already set up with all necessary dependencies:

```bash
npm install
```

## Dependencies

- **TypeScript**: For type-safe development
- **Puppeteer**: For scraping dynamic JavaScript-rendered content
- **Cheerio**: For parsing static HTML content
- **Axios**: For making HTTP requests
- **ts-node**: For running TypeScript files directly

## Usage

### Puppeteer Scraper (Dynamic Content)

For websites that require JavaScript rendering:

```typescript
import { WebScraper } from './src/scraper';

const scraper = new WebScraper();
await scraper.initialize();

// Scrape entire page
const result = await scraper.scrapePage('https://example.com');

// Scrape specific elements
const headings = await scraper.scrapeWithSelector('https://example.com', 'h1, h2, h3');

await scraper.close();
```

### Cheerio Scraper (Static Content)

For static HTML websites:

```typescript
import { CheerioScraper } from './src/cheerio-scraper';

const scraper = new CheerioScraper();

// Scrape entire page
const result = await scraper.scrapePage('https://example.com');

// Scrape specific elements
const headings = await scraper.scrapeWithSelector('https://example.com', 'h1, h2, h3');

// Scrape tables
const tableData = await scraper.scrapeTable('https://example.com', 'table.my-table');
```

## Running the Scrapers

### Build the project:
```bash
npm run build
```

### Run the Puppeteer scraper:
```bash
npm start
```

### Run the Cheerio scraper:
```bash
npm run start:cheerio
```

### Development mode (with file watching):
```bash
npm run dev
```

## Features

### WebScraper (Puppeteer)
- ✅ Full browser automation
- ✅ JavaScript rendering support
- ✅ User agent spoofing
- ✅ Error handling
- ✅ Resource cleanup

### CheerioScraper
- ✅ Fast static HTML parsing
- ✅ CSS selector support
- ✅ Table data extraction
- ✅ Lightweight and efficient

## Example Output

```json
{
  "title": "Example Domain",
  "content": "This domain is for use in illustrative examples...",
  "links": [
    "https://www.iana.org/domains/example",
    "https://www.iana.org/domains/reserved"
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Customization

You can extend the scrapers by:

1. Adding new methods to the classes
2. Creating custom selectors for specific websites
3. Implementing data transformation logic
4. Adding export functionality (JSON, CSV, etc.)

## Notes

- The scrapers include proper user agent headers to avoid being blocked
- Timeout is set to 30 seconds for requests
- Error handling is implemented for network issues
- Remember to respect robots.txt and website terms of service 