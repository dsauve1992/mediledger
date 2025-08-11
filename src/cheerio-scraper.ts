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

// Helper function to clean HTML content by removing styles and empty nodes
function cleanHtmlContent($: cheerio.Root, html: string): string {
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
    const text = $element.text().trim();
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

function extractSectionContent($: cheerio.Root, sectionId: string, nextSectionId?: string): RawElement[] {
  const rawElements: RawElement[] = [];
  
  // Find the current section element
  const $section = $(`[id="${sectionId}"]`);
  if (!$section.length) return rawElements;
  
  // If no next section, collect everything after this section
  if (!nextSectionId) {
    let $current = $section.next();
    while ($current.length > 0) {
      const html = $.html($current);
      const text = $current.text().trim();
      
      if (html && html.trim() && text.length) {
        const cleanedHtml = cleanHtmlContent($, html);
        if (cleanedHtml) {
          rawElements.push({
            type: 'raw',
            content: cleanedHtml
          });
        }
      }
      $current = $current.next();
    }
    return rawElements;
  }
  
  // Find the next section
  const $nextSection = $(`[id="${nextSectionId}"]`);
  if (!$nextSection.length) return rawElements;
  
  // Collect all elements between current section and next section
  let $current = $section.next();
  
  while ($current.length > 0 && $current[0] !== $nextSection[0]) {
    // Check if this element contains the next section
    if ($current.find(`[id="${nextSectionId}"]`).length > 0) {
      // This element contains the next section, so we need to be careful
      // Only collect elements that come before the next section within this element
      const elementsBeforeNext = collectElementsBeforeSection($, $current, nextSectionId);
      rawElements.push(...elementsBeforeNext);
      break;
    }
    
    // Add this element if it has content
    const html = $.html($current);
    const text = $current.text().trim();
    
    if (html && html.trim() && text.length) {
      const cleanedHtml = cleanHtmlContent($, html);
      if (cleanedHtml) {
        rawElements.push({
          type: 'raw',
          content: cleanedHtml
        });
      }
    }
    
    $current = $current.next();
  }
  
  return rawElements;
}

function collectElementsBeforeSection($: cheerio.Root, $container: cheerio.Cheerio, sectionId: string): RawElement[] {
  const elements: RawElement[] = [];
  const $nextSection = $container.find(`[id="${sectionId}"]`).first();
  
  if (!$nextSection.length) return elements;
  
  // Get all direct children of the container
  const $children = $container.children();
  
  for (let i = 0; i < $children.length; i++) {
    const $child = $children.eq(i);
    
    // If we've reached the next section, stop collecting
    if ($child[0] === $nextSection[0]) {
      break;
    }
    
    // Check if this child contains the next section
    if ($child.find(`[id="${sectionId}"]`).length > 0) {
      // Recursively collect elements before the section within this child
      const nestedElements = collectElementsBeforeSection($, $child, sectionId);
      elements.push(...nestedElements);
      break;
    }
    
    // Add this child if it has content
    const html = $.html($child);
    const text = $child.text().trim();
    
    if (html && html.trim() && text.length) {
      const cleanedHtml = cleanHtmlContent($, html);
      if (cleanedHtml) {
        elements.push({
          type: 'raw',
          content: cleanedHtml
        });
      }
    }
  }
  
  return elements;
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
