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
    fs.writeFileSync('./output-document.json', JSON.stringify(document, null, 2), 'utf-8');
    
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

  return { content: documentSections };
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

  // Step 1: Validate that the order of menu items is respected in the content node
  const validationResult = validateMenuOrderInContent($, flattenedItems);
  if (!validationResult.isValid) {
    console.warn('⚠️  Menu order validation failed:', validationResult.issues);
    console.warn('Proceeding with processing, but content order may be incorrect');
    
    // Optionally reorder items based on DOM position
    const reorderedItems = reorderItemsByDomPosition($, flattenedItems);
    if (reorderedItems.length > 0) {
      console.log('🔄 Reordering items based on DOM position for more accurate content extraction');
      flattenedItems = reorderedItems;
    }
  } else {
    console.log('✅ Menu order validation passed - all sections appear in correct order');
  }

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

    // Extract content for this section
    if (currentItem.id) {
      const sectionContent = extractSectionContent($, currentItem.id, nextItem?.id);
      if (sectionContent.length > 0) {
        section.subsections.push(...sectionContent);
      }
    }

    documentSections.push(section);
  }

  return documentSections;
}

function reorderItemsByDomPosition($: cheerio.Root, flattenedItems: MenuItem[]): MenuItem[] {
  const contenuNode = $('#contenu');
  if (!contenuNode.length) return flattenedItems;

  // Filter items that have IDs
  const itemsWithIds = flattenedItems.filter(item => item.id);
  
  // Find all section elements in the content node and their DOM positions
  const sectionPositions: { item: MenuItem; domIndex: number }[] = [];
  
  contenuNode.find('*[id]').each((domIndex, element) => {
    const $element = $(element);
    const id = $element.attr('id');
    const menuItem = itemsWithIds.find(item => item.id === id);
    
    if (menuItem) {
      sectionPositions.push({
        item: menuItem,
        domIndex
      });
    }
  });

  // Sort by DOM position
  sectionPositions.sort((a, b) => a.domIndex - b.domIndex);

  // Create reordered list
  const reorderedItems: MenuItem[] = [];
  
  // Add items that were found in DOM in their correct order
  sectionPositions.forEach(({ item }) => {
    reorderedItems.push(item);
  });

  // Add any remaining items that weren't found in DOM (they'll be at the end)
  const foundIds = new Set(sectionPositions.map(sp => sp.item.id));
  const remainingItems = itemsWithIds.filter(item => !foundIds.has(item.id));
  reorderedItems.push(...remainingItems);

  return reorderedItems;
}

function validateMenuOrderInContent($: cheerio.Root, flattenedItems: MenuItem[]): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];
  const contenuNode = $('#contenu');
  
  if (!contenuNode.length) {
    issues.push('No #contenu node found');
    return { isValid: false, issues };
  }

  // Filter items that have IDs
  const itemsWithIds = flattenedItems.filter(item => item.id);
  
  if (itemsWithIds.length === 0) {
    issues.push('No menu items with IDs found');
    return { isValid: false, issues };
  }

  // Find all section elements in the content node
  const sectionElements: { id: string; element: cheerio.Element; index: number }[] = [];
  
  contenuNode.find('*[id]').each((index, element) => {
    const $element = $(element);
    const id = $element.attr('id');
    if (id && itemsWithIds.some(item => item.id === id)) {
      sectionElements.push({
        id,
        element,
        index
      });
    }
  });

  // Sort section elements by their DOM order
  sectionElements.sort((a, b) => a.index - b.index);

  // Check if the order matches the menu order
  let isValid = true;
  for (let i = 0; i < sectionElements.length - 1; i++) {
    const currentId = sectionElements[i].id;
    const nextId = sectionElements[i + 1].id;
    
    const currentMenuIndex = itemsWithIds.findIndex(item => item.id === currentId);
    const nextMenuIndex = itemsWithIds.findIndex(item => item.id === nextId);
    
    if (currentMenuIndex > nextMenuIndex) {
      isValid = false;
      issues.push(`Section "${currentId}" appears in DOM before "${nextId}" but comes after it in menu order`);
    }
  }

  // Additional check: verify all menu items with IDs are found in content
  const foundIds = new Set(sectionElements.map(se => se.id));
  const missingIds = itemsWithIds.filter(item => !foundIds.has(item.id!));
  
  if (missingIds.length > 0) {
    isValid = false;
    issues.push(`Missing sections in content: ${missingIds.map(item => item.id).join(', ')}`);
  }

  return { isValid, issues };
}

function extractSectionContent($: cheerio.Root, sectionId: string, nextSectionId?: string): RawElement[] {
  const rawElements: RawElement[] = [];
  
  // Find the current section element
  const $section = $(`[id="${sectionId}"]`);
  if (!$section.length) return rawElements;
  
  // Find the next section element if it exists
  const $nextSection = nextSectionId ? $(`[id="${nextSectionId}"]`) : null;
  
  // Start from the current section and collect all content until we hit the next section
  let $current = $section;
  
  while ($current.length > 0) {
    // Move to the next element
    $current = $current.next();
    
    // Stop if we hit the next section
    if ($nextSection && $current[0] === $nextSection[0]) {
      break;
    }
    
    // Stop if this element contains the next section
    if ($nextSection && $current.find(`[id="${nextSectionId}"]`).length > 0) {
      break;
    }
    
    // Stop if we hit another major section header (h1, h2) that's not the current one
    if ($current.attr('id') && $current.attr('id') !== sectionId) {
      // Check if this looks like a major section header (contains h1 or h2)
      if ($current.find('h1, h2').length > 0) {
        // But allow h3 and below as they are subsections within the current section
        break;
      }
    }
    
    // Only collect if this element has meaningful content
    const html = $.html($current);
    const text = $current.text().trim();
    
    if (html && html.trim() && text.length > 0) {
      // Check if this element contains any major section headers (avoid collecting nested major sections)
      const hasMajorSectionHeaders = $current.find('h1, h2').length > 0;
      
      if (!hasMajorSectionHeaders) {
        const cleanedHtml = cleanHtmlContent(html);
        if (cleanedHtml) {
          rawElements.push({
            type: 'raw',
            content: cleanedHtml
          });
        }
      }
    }
  }
  
  return rawElements;
}

function cleanHtmlContent(html: string): string {
  if (!html || !html.trim()) return '';

  // Load the HTML into a temporary cheerio instance for cleaning
  const $temp = cheerio.load(html);

  // Remove all style attributes
  $temp('[style]').removeAttr('style');

  // Remove all style tags
  $temp('style').remove();

  // Remove all link tags (CSS)
  $temp('link[rel="stylesheet"]').remove();

  // Remove all script tags
  $temp('script').remove();

  // Remove nodes with no text content
  $temp('*').each((_, element) => {
    const $element = $temp(element);
    const text = $element.text()
    if (text.length === 0) {
      $element.remove();
    }
  });

  // Get the cleaned HTML
  const cleanedHtml = $temp.html();

  // Final check: if the cleaned HTML has no text content, return empty string
  if (!cleanedHtml || $temp('body').text().trim().length === 0) {
    return '';
  }

  return cleanedHtml;
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
  const normalizedExtracted = "Manuel des médecins spécialiste - Rémunération à l'acte "+normalizeWhitespace(extractedText);

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
