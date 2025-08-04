import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';


// Example usage
async function main() {
  const filePath = './src/manuel-specialistes-remuneration-acte.html';

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
  
  // Step 1: Flatten the menuItems list
  const flattenedItems = flattenMenuItems(menuItems);
  
  // Step 2: Extract content between sections and reconstruct nested structure
  return reconstructDocumentSections($, flattenedItems);
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
    
    // Create the current section
    const section: DocumentSection = {
      name: currentItem.name,
      type: currentItem.type,
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
  let collecting = false;
  const betweenNodes: cheerio.Element[] = [];
  
  function walk(node: cheerio.Element) {
    if (!node) return;
    
    // Check if this is a tag element with attributes
    if (node.type === 'tag' && 'attribs' in node) {
      const tagNode = node as cheerio.TagElement;
      
      // Start collecting after current section
      if (tagNode.attribs?.id === currentId) {
        collecting = true;
        return;
      }
      
      // Stop collecting before next section
      if (nextId && tagNode.attribs?.id === nextId) {
        collecting = false;
        return;
      }
    }
    
    if (collecting) {
      betweenNodes.push(node);
    }
    
    // Recurse into children
    if ('children' in node && node.children) {
      for (let child of node.children) {
        if (child.type === 'tag') {
          walk(child);
        }
      }
    }
  }
  
  // Start walking from the body
  const body = $('body')[0];
  if (body) {
    walk(body);
  }
  
  // Group nodes by their parent to keep complete elements intact
  const groupedElements = groupNodesByParent($, betweenNodes);
  
  // Convert grouped elements to RawElements
  for (const group of groupedElements) {
    if (group.length > 0) {
      // Create a temporary container to hold all elements in the group
      const container = $('<div>');
      for (const node of group) {
        container.append($.html(node));
      }
      const html = container.html();
      if (html && html.trim()) {
        rawElements.push({
          type: 'raw',
          content: html
        });
      }
    }
  }
  
  return rawElements;
}

function groupNodesByParent($: cheerio.Root, nodes: cheerio.Element[]): cheerio.Element[][] {
  if (nodes.length === 0) return [];
  
  const groups: cheerio.Element[][] = [];
  const processedNodes = new Set<cheerio.Element>();
  
  for (const node of nodes) {
    if (processedNodes.has(node)) continue;
    
    const group: cheerio.Element[] = [];
    const parent = findTopLevelParent($, node, nodes);
    
    // Collect all nodes that belong to the same top-level parent
    for (const otherNode of nodes) {
      if (!processedNodes.has(otherNode) && isDescendantOf($, otherNode, parent)) {
        group.push(otherNode);
        processedNodes.add(otherNode);
      }
    }
    
    if (group.length > 0) {
      groups.push(group);
    }
  }
  
  return groups;
}

function findTopLevelParent($: cheerio.Root, node: cheerio.Element, allNodes: cheerio.Element[]): cheerio.Element {
  let current = node;
  
  while (current.parent && current.parent.type === 'tag') {
    const parent = current.parent as cheerio.Element;
    
    // Check if this parent contains any of our target nodes
    const hasTargetNodes = allNodes.some(targetNode => 
      targetNode !== node && isDescendantOf($, targetNode, parent)
    );
    
    // If parent contains other target nodes, this is not the top-level parent
    if (hasTargetNodes) {
      current = parent;
    } else {
      break;
    }
  }
  
  return current;
}

function isDescendantOf($: cheerio.Root, node: cheerio.Element, ancestor: cheerio.Element): boolean {
  let current = node.parent;
  
  while (current && current.type === 'tag') {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  
  return false;
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

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
} 