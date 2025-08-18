import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import {extractNodesPreserveStructure} from "./utils";
import * as diff from "diff";

interface Document {
  content: (DocumentSection | RawElement)[];
}

interface DocumentSection {
  name: string;
  type: 'section';
  id?: string;
  subsections: (DocumentSection | RawElement)[];
}

interface RawElement {
  type: 'raw';
  content: string;
}

interface MenuItem {
  name: string;
  type: string;
  id?: string;
  subsections: MenuItem[];
}

interface SectionWithContent {
    id?: string;
    name: string;
    content: string[];
}

// Example usage
async function main() {
  const filePath = './src/manuel-specialistes-remuneration-acte.html';

  try {
    console.log('=== STARTING SCRAPER ===');
    console.log(`Scraping local file: ${filePath}`);

    const absolutePath = path.resolve(filePath);
    const htmlContent = fs.readFileSync(absolutePath, 'utf-8');
    const $ = cheerio.load(htmlContent);

    const document = parseDocument($);
  } catch (error) {
    console.error(`Error scraping local file ${filePath}:`, error);
  }
}

function grabMainSectionsToTheRoot($: cheerio.Root, flattenedItems: MenuItem[]): string {
  let raw = $.html()

  for (const index in flattenedItems) {
    const item = flattenedItems[index];
    raw = extractNodesPreserveStructure(raw, '#contenu', `#${item.id!}`);
    console.log(`Extracted content (${parseInt(index) + 1}/${flattenedItems.length}) for ID: ${item.id}`);
  }

  return raw
}

function getDocumentWithMainSectionAsDirectChildren($: cheerio.Root, flattenedItems: MenuItem[]) {
  if (fs.existsSync('./modified-raw-content.html')) {
    console.log('Modified raw content file already exists. Skipping reconstruction.');

    return fs.readFileSync('./modified-raw-content.html', 'utf-8');
  }
  const modifiedContenuSection = grabMainSectionsToTheRoot($, flattenedItems);
  fs.writeFileSync('./modified-raw-content.html', modifiedContenuSection, 'utf-8');

  return modifiedContenuSection
}

function parseDocument($: cheerio.Root) {
  const menuGauche = $('#menuGauche');
  if (!menuGauche.length) {
    console.log('No #menuGauche found in document');
    return { content: [] };
  }

  // Find the main navigation ul
  const navUl = menuGauche.find('#nav');
  if (!navUl.length) {
    console.log('No #nav found in menuGauche');
    return { content: [] };
  }

  const menuItems = parseMenuList($, navUl, 1);

  // Step 1: Flatten the menuItems list
  const flattenedItems = flattenMenuItems(menuItems);
  const modifiedContenuSection = getDocumentWithMainSectionAsDirectChildren($, flattenedItems);


  // Step 2: extract content for each main section and its subsections
  // since every section is now a direct child of #contenu, we can just extract the content between sections and affect that content the previous section. we also have to handle the content before the first section
  const sectionsWithContent: SectionWithContent[] = [];

    let currentSection: SectionWithContent = { id: '', name: '', content: [] };
    const modifiedRoot$ = cheerio.load(modifiedContenuSection);
  modifiedRoot$('#contenu > *').each((_, element) => {
        const $element = $(element);
        const id = $element.attr('id');
        const name = $element.text().trim()
        const content = $.html(element) || '';

        if (id && flattenedItems.some(item => item.id === id)) {
            // If we encounter a new section, push the previous one if it exists
            if (currentSection) {
            sectionsWithContent.push(currentSection);
            }
            // Start a new section
            currentSection = { id, name, content: [] };
        } else if (currentSection) {
            // If it's not a section but we have a current section, append content to it
            currentSection.content.push(content);
        }
    })

  sectionsWithContent.push(currentSection);

  // save sectionsWithContent
    fs.writeFileSync('./sectionsWithContent.json', JSON.stringify(sectionsWithContent, null, 2), 'utf-8');

    const raw = sectionsWithContent.reduce((acc, section) => {
        return acc + section.name + '\n' + cheerio.load(section.content.join('')).root().text() + '\n';
    }, '')


    console.log(`Extracted ${sectionsWithContent.length} sections with content`);

  const originalContenuText = getContenuString($)
  const rawWithoutCarriageReturns = raw

  compareString(originalContenuText, rawWithoutCarriageReturns)
}

function parseMenuList($: cheerio.Root, $ul: cheerio.Cheerio, level: number): MenuItem[] {
  const menuItems: MenuItem[] = [];

  $ul.children('li').each((_, liElement) => {
    const $li = $(liElement);
    const $link = $li.children('a').first();

    if ($link.length) {
      const text = $link.text().trim();
      const href = $link.attr('href');
      // Extract just the ID number from the href (e.g., "248224" from the full URL)
      const id = href ? href.split('#').pop() || undefined : undefined;

      if (text) {
        const menuItem: MenuItem = {
          name: text,
          type: `level${level}`,
          id: id,
          subsections: []
        };

        // Check if this item has nested subsections
        const $nestedUl = $li.children('ul');
        if ($nestedUl.length) {
          menuItem.subsections = parseMenuList($, $nestedUl, level + 1);
        }

        menuItems.push(menuItem);
      }
    }
  });

  return menuItems;
}

function flattenMenuItems(menuItems: MenuItem[]): MenuItem[] {
  const flattened: MenuItem[] = [];

  function flattenRecursive(items: MenuItem[]) {
    for (const item of items) {
      // Add the current item (without subsections)
      const flatItem: MenuItem = {
        name: item.name,
        type: item.type,
        id: item.id,
        subsections: []
      };
      flattened.push(flatItem);

      // Recursively flatten subsections
      if (item.subsections.length > 0) {
        flattenRecursive(item.subsections);
      }
    }
  }

  flattenRecursive(menuItems);
  return flattened;
}


function compareString(originalText: string, extractedText: string) {
  const normalizeWhitespace = (text: string): string => {
    return text
        .replace(/\s+/g, '')  // Replace multiple whitespace with single space
        .replace(/\n+/g, ' ')   // Replace newlines with spaces
        .replace(/\t/g, ' ')   // Replace tabs with spaces
        .replace(/—/g, '-')    // Replace em dash with regular dash
        .replace(/"/g, '"')    // Replace smart quotes with regular quotes
        .replace(/È/g, 'E')   // Replace È with E
        .replace(/É/g, 'E')   // Replace É with E
        .replace(/Ê/g, 'E')   // Replace Ê with E
        .replace(/Ë/g, 'E')   // Replace Ë with E
        .replace(/À/g, 'A')   // Replace À with A
        .replace(/Â/g, 'A')   // Replace Â with A
        .replace(/Ä/g, 'A')   // Replace Ä with A
        .replace(/Ù/g, 'U')   // Replace Ù with U
        .replace(/Û/g, 'U')   // Replace Û with U
        .replace(/Ü/g, 'U')   // Replace Ü with U
        .replace(/Î/g, 'I')   // Replace Î with I
        .replace(/Ï/g, 'I')   // Replace Ï with I
        .replace(/Ô/g, 'O')   // Replace Ô with O
        .replace(/Œ/g, 'OE')  // Replace Œ with OE
        .replace(/œ/g, 'oe')  // Replace œ with oe
        .trim();               // Remove leading/trailing whitespace
  };

  const normalizedOriginal = normalizeWhitespace(originalText);
  const normalizedExtracted = normalizeWhitespace(extractedText);

  // Compare the normalized versions
  const isIdentical = isTextEqualIgnoringWhitespace(normalizedOriginal, normalizedExtracted);
  console.log(`Content identical (normalized): ${isIdentical ? '✅ YES' : '❌ NO'}`);

  if (!isIdentical) {
    console.log('\n=== DIFFERENCES FOUND ===');
    console.log('Normalized original text starts with:', normalizedOriginal.substring(0, 200));
    console.log('Normalized extracted text starts with:', normalizedExtracted.substring(0, 200));
    // Find the first difference
    const minLength = Math.min(normalizedOriginal.length, normalizedExtracted.length);
    for (let i = 0; i < minLength; i++) {
      if (normalizedOriginal[i] !== normalizedExtracted[i]) {
        console.log(`First difference at position ${i}:`);
        console.log(`Original: "${normalizedOriginal.substring(i, i + 50)}"`);
        console.log(`Extracted: "${normalizedExtracted.substring(i, i + 50)}"`);
        break;
      }
    }
  } else {
    console.log('🎉 All content successfully extracted!');
  }
}

function isTextEqualIgnoringWhitespace(a: string, b: string): boolean {
  const changes = diff.diffWords(a, b);

  // If any change is an addition or removal with non-whitespace chars → not equal
  return changes.every(change => {
    if (change.added || change.removed) {
      return change.value.trim().length < 2; // allow pure whitespace diffs
    }
    return true;
  });
}

function testContentCompleteness($: cheerio.Root, modifiedContenuNode: string) {
  console.log('\n=== TESTING CONTENT COMPLETENESS ===');

  // Get original content from #contenu
  const originalText = getContenuString($);
  console.log(`Original #Contenu text length: ${originalText.length} characters`);

  // Flatten our Document content and extract all text
  const extractedText = cheerio.load(modifiedContenuNode)('#contenu').text().trim();
  console.log(`Extracted text length: ${extractedText.length} characters`);
  compareString(originalText, extractedText);
}

function getContenuString($: cheerio.Root) {
  const originalContenuNode = $('#contenu');

  if (!originalContenuNode.length) {
    throw new Error('❌ No #contenu node found');
  }

  return originalContenuNode.text().trim();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}
