import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';


// Example usage
async function main() {
  const filePath = './manuel-specialistes-remuneration-acte.html';

  try {
    console.log('=== STARTING SCRAPER ===');
    console.log(`Scraping local file: ${filePath}`);
    
    const absolutePath = path.resolve(filePath);
    const htmlContent = fs.readFileSync(absolutePath, 'utf-8');
    const $ = cheerio.load(htmlContent);

    const menuStructure = parseDocument($);
    console.log('Menu Structure parsed successfully');
    console.log('Menu Structure:', JSON.stringify(menuStructure, null, 2));
  } catch (error) {
    console.error(`Error scraping local file ${filePath}:`, error);
  }
}


interface DocumentSection {
  name: string;
  type: string;
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

function parseDocument($: cheerio.Root): DocumentSection[] {
  const menuGauche = $('#menuGauche');
  if (!menuGauche.length) {
    console.log('No #menuGauche found in document');
    return [];
  }

  // Find the main navigation ul
  const navUl = menuGauche.find('#nav');
  if (!navUl.length) {
    console.log('No #nav found in menuGauche');
    return [];
  }

  const menuItems = parseMenuList($, navUl, 1);

  return convertMenuToDocumentStructure($, menuItems);
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

function convertMenuToDocumentStructure($: cheerio.Root, menuItems: MenuItem[]): DocumentSection[] {
  // Find all content elements in the document
  const contentSection = $('#contenu');
  if (!contentSection.length) {
    return convertMenuItemsToDocumentSections(menuItems);
  }

  // Get all elements in the content section, but be more selective to avoid duplicates
  // We'll get elements that either have IDs or are text-containing elements
  const allContentElements = contentSection.children()
  
  // Create a flat list of all menu items with their IDs for quick lookup
  const menuItemMap = new Map<string, MenuItem>();
  function addMenuItemsToMap(items: MenuItem[]) {
    items.forEach(item => {
      if (item.id) {
        menuItemMap.set(item.id, item);
      }
      if (item.subsections.length > 0) {
        addMenuItemsToMap(item.subsections);
      }
    });
  }
  addMenuItemsToMap(menuItems);
  
  // Sequential parsing of the document
  return parseDocumentSequentially($, menuItems, allContentElements, menuItemMap);
}

function parseDocumentSequentially(
  $: cheerio.Root, 
  menuItems: MenuItem[], 
  contentElements: cheerio.Cheerio, 
  menuItemMap: Map<string, MenuItem>
): DocumentSection[] {
  
  // Initialize document sections with empty subsections
  const documentSections = convertMenuItemsToDocumentSections(menuItems);
  
  // Create a map to track current section for each level
  const currentSections: DocumentSection[] = [];
  
  // Process each content element sequentially
  contentElements.each((_, element) => {
    const $element = $(element);
    const elementId = $element.attr('id');
    const elementText = $element.text().trim();
    
    if (!elementText) return; // Skip empty elements
    
    if (elementId && menuItemMap.has(elementId)) {
      // This element matches a menu item - update current section
      const matchingMenuItem = menuItemMap.get(elementId)!;
      updateCurrentSection(matchingMenuItem, documentSections, currentSections);
    } else {
      // This is raw content - add it to the current section
      const rawElement: RawElement = {
        type: 'raw',
        content: elementText
      };
      
      if (currentSections.length > 0) {
        // Add to the deepest current section
        const deepestSection = currentSections[currentSections.length - 1];
        deepestSection.subsections.push(rawElement);
      }
    }
  });
  
  return documentSections;
}

function updateCurrentSection(
  menuItem: MenuItem, 
  documentSections: DocumentSection[], 
  currentSections: DocumentSection[]
): void {
  // Find the corresponding document section
  const documentSection = findDocumentSection(menuItem, documentSections);
  if (!documentSection) return;
  
  // Update current sections based on the level
  const level = parseInt(menuItem.type.replace('level', ''));
  
  // Remove deeper levels
  while (currentSections.length >= level) {
    currentSections.pop();
  }
  
  // Add this section
  currentSections.push(documentSection);
}

function findDocumentSection(menuItem: MenuItem, documentSections: DocumentSection[]): DocumentSection | null {
  for (const section of documentSections) {
    if (section.id === menuItem.id) {
      return section;
    }
    if (section.subsections.length > 0) {
      const found = findDocumentSectionInSubsections(menuItem, section.subsections);
      if (found) return found;
    }
  }
  return null;
}

function findDocumentSectionInSubsections(
  menuItem: MenuItem, 
  subsections: (DocumentSection | RawElement)[]
): DocumentSection | null {
  for (const subsection of subsections) {
    if (subsection.type === 'raw') continue;
    
    const docSection = subsection as DocumentSection;
    if (docSection.id === menuItem.id) {
      return docSection;
    }
    if (docSection.subsections.length > 0) {
      const found = findDocumentSectionInSubsections(menuItem, docSection.subsections);
      if (found) return found;
    }
  }
  return null;
}

function convertMenuItemsToDocumentSections(menuItems: MenuItem[]): DocumentSection[] {
  return menuItems.map(menuItem => {
    const documentSection: DocumentSection = {
      name: menuItem.name,
      type: menuItem.type,
      id: menuItem.id,
      subsections: menuItem.subsections.length > 0 
        ? convertMenuItemsToDocumentSections(menuItem.subsections)
        : []
    };
    
    return documentSection;
  });
}



// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
} 