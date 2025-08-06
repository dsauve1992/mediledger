import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

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
    
    // Test: Compare original content with extracted content
    testContentCompleteness($, document);
  } catch (error) {
    console.error(`Error scraping local file ${filePath}:`, error);
  }
}

function parseDocument($: cheerio.Root): Document {
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

  // Step 2: Extract content between sections and reconstruct nested structure
  const documentSections = reconstructDocumentSections($, flattenedItems);

  // Step 3: Extract content before the first menu section
  const content: (DocumentSection | RawElement)[] = [];

  if (flattenedItems.length > 0 && flattenedItems[0].id) {
    const contentBeforeFirstSection = extractContentBeforeSection($, flattenedItems[0].id);
    if (contentBeforeFirstSection.length > 0) {
      content.push(...contentBeforeFirstSection);
    }
  }

  // Step 4: Add all document sections
  content.push(...documentSections);

  return { content };
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

function reconstructDocumentSections($: cheerio.Root, flattenedItems: MenuItem[]): DocumentSection[] {
  const documentSections: DocumentSection[] = [];

  for (let i = 0; i < flattenedItems.length; i++) {
    const currentItem = flattenedItems[i];
    const nextItem = flattenedItems[i + 1];

    // Find the actual element in #contenu and get its real text
    let actualName = currentItem.name;
    if (currentItem.id) {
      const actualElement = $(`[id="${currentItem.id}"]`);
      if (actualElement.length > 0) {
        // Get the actual text from the element in #contenu
        const actualText = actualElement.text().trim();
        if (actualText) {
          actualName = actualText;
        }
      }
    }

    // Create the current section with the actual name from #contenu
    const section: DocumentSection = {
      name: actualName,
      type: 'section',
      id: currentItem.id,
      subsections: []
    };

    // Extract content between current item and next item
    if (currentItem.id) {
      const contentBetween = extractContentBetweenSections($, currentItem.id, nextItem?.id);
      if (contentBetween.length > 0) {
        section.subsections.push(...contentBetween);
      }
    }

    documentSections.push(section);
  }

  return documentSections;
}

function extractContentBetweenSections($: cheerio.Root, currentId: string, nextId?: string): RawElement[] {
  const rawElements: RawElement[] = [];
  
  // Find the current section element
  const currentSection = $(`[id="${currentId}"]`);
  if (currentSection.length === 0) return rawElements;
  
  // Get the parent container that holds both sections
  const parent = currentSection.parent();
  if (parent.length === 0) return rawElements;
  
  // Get all elements between current section and next section
  let currentElement = currentSection.next();
  const collectedElements: cheerio.Element[] = [];
  
  while (currentElement.length > 0) {
    // Stop if we reach the next section
    if (nextId && currentElement.attr('id') === nextId) {
      break;
    }
    
    // Check if this element contains the next section
    const containsNextSection = nextId ? currentElement.find(`[id="${nextId}"]`).length > 0 : false;
    
    if (containsNextSection) {
      // If this element contains the next section, we need to dig deeper
      // but only collect elements that come before the next section
      const nextSectionInElement = currentElement.find(`[id="${nextId}"]`).first();
      let childElement = currentElement.children().first();
      
      while (childElement.length > 0 && childElement[0] !== nextSectionInElement[0]) {
        const html = $.html(childElement);
        const text = childElement.text().trim();
        
        if (html && html.trim() && text.length) {
          collectedElements.push(childElement[0]);
        }
        childElement = childElement.next();
      }
    } else {
      const html = $.html(currentElement);
      const text = currentElement.text().trim();

      if (html && html.trim() && text.length ) {
        collectedElements.push(currentElement[0]);
      }
    }
    
    currentElement = currentElement.next();
  }
  
  // Remove duplicates using a more aggressive approach
  const uniqueElements = removeDuplicateNodes(collectedElements);
  
  // Convert to RawElements, but be more selective about content
  for (const element of uniqueElements) {
    const html = $.html(element);
    const text = $(element).text().trim();
    
    // Only include elements with substantial content and avoid very repetitive content
    if (html && html.trim() && text.length) {
        rawElements.push({
          type: 'raw',
          content: html
        });
    }
  }
  
  return rawElements;
}

function removeDuplicateNodes(nodes: cheerio.Element[]): cheerio.Element[] {
  const uniqueNodes: cheerio.Element[] = [];
  const processedText = new Set<string>();
  const processedHtml = new Set<string>();

  for (const node of nodes) {
    // Extract text content for comparison
    const $temp = cheerio.load('');
    const $node = $temp('body').append($temp.html(node));
    const textContent = $node.text().trim();

    // Skip empty nodes or very short content
    if (!textContent || textContent.length === 0) continue;

    // Also check HTML content to catch more duplicates
    const htmlContent = $temp.html(node).trim();

    // Check if we've already processed this content (either text or HTML)
    if (!processedHtml.has(htmlContent)) {
      processedText.add(textContent);
      processedHtml.add(htmlContent);
      uniqueNodes.push(node);
    }
  }

  return uniqueNodes;
}

function extractContentBeforeSection($: cheerio.Root, firstSectionId: string): RawElement[] {
  const rawElements: RawElement[] = [];

  // Find the first section element
  const firstSection = $(`[id="${firstSectionId}"]`);
  if (firstSection.length === 0) return rawElements;

  // Focus on the #contenu element where the main content is
  const contenuNode = $('#contenu');
  if (contenuNode.length === 0) return rawElements;

  // Get all elements from the beginning of #contenu to the first section
  let currentElement = contenuNode.children().first();
  const collectedElements: cheerio.Element[] = [];

  while (currentElement.length > 0) {
    // Stop when we reach the first section
    if (currentElement.attr('id') === firstSectionId) {
      break;
    }

    // Only collect elements that have meaningful content
    const html = $.html(currentElement);
    const text = currentElement.text().trim();

    if (html && html.trim() && text.length > 10) { // Only elements with substantial text
      collectedElements.push(currentElement[0]);
    }

    currentElement = currentElement.next();
  }

  // Remove duplicates
  const uniqueElements = removeDuplicateNodes(collectedElements);

  // Convert to RawElements, but be more selective
  let count = 0;
  for (const element of uniqueElements) {
    if (count >= 50) break; // Reduced limit to avoid too much content

    const html = $.html(element);
    const text = $(element).text().trim();

    if (html && html.trim() && text.length > 20) { // Only substantial content
      rawElements.push({
        type: 'raw',
        content: html
      });
      count++;
    }
  }

  return rawElements;
}

function testContentCompleteness($: cheerio.Root, document: Document) {
  console.log('\n=== TESTING CONTENT COMPLETENESS ===');

  // Get original content from #contenu
  const contenuNode = $('#contenu');
  if (!contenuNode.length) {
    console.log('❌ No #contenu node found');
    return;
  }

  const originalText = contenuNode.text().trim();
  console.log(`Original #Contenu text length: ${originalText.length} characters`);

  // Flatten our Document content and extract all text
  const extractedText = flattenDocumentContent(document);
  console.log(`Extracted text length: ${extractedText.length} characters`);

  // Normalize whitespace for comparison
  const normalizeWhitespace = (text: string): string => {
    return text
      .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
      .replace(/\n+/g, ' ')   // Replace newlines with spaces
      .replace(/\t/g, ' ')   // Replace tabs with spaces
      .replace(/—/g, '-')    // Replace em dash with regular dash
      .replace(/–/g, '-')    // Replace en dash with regular dash
      .replace(/"/g, '"')    // Replace smart quotes with regular quotes
      .replace(/"/g, '"')    // Replace smart quotes with regular quotes
      .replace(/'/g, "'")    // Replace smart apostrophes with regular apostrophes
      .replace(/'/g, "'")    // Replace smart apostrophes with regular apostrophes
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
  const isIdentical = normalizedOriginal === normalizedExtracted;
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

function flattenDocumentContent(document: Document): string {
  const allText: string[] = [];

  function extractTextFromContent(content: (DocumentSection | RawElement)[]) {
    for (const item of content) {
      if (item.type === 'raw') {
        const rawElement = item as RawElement;
        // Extract text from HTML content
        const $temp = cheerio.load(rawElement.content);
        allText.push($temp('body').text());
      } else if (item.type === 'section') {
        const section = item as DocumentSection;
        allText.push(section.name);
        extractTextFromContent(section.subsections);
      }
    }
  }

  extractTextFromContent(document.content);
  return allText.join(' ').trim();
}


// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}
