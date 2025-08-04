import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';


// Example usage
async function main() {
  const filePath = './src/manuel-specialistes-remuneration-acte.html';

  try {
    console.log(`Scraping local file: ${filePath}`);
    
    const absolutePath = path.resolve(filePath);
    const htmlContent = fs.readFileSync(absolutePath, 'utf-8');
    const $ = cheerio.load(htmlContent);

    const menuStructure = parseDocument($);
    console.log('Menu Structure:', JSON.stringify(menuStructure, null, 2));
  } catch (error) {
    console.error(`Error scraping local file ${filePath}:`, error);
  }
}


interface MenuItem {
  name: string;
  type: string;
  id?: string;
  subsections: MenuItem[];
}

function parseDocument($: cheerio.Root): MenuItem[] {
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

  return parseMenuList($, navUl, 1);
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