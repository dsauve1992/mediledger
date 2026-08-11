import fs from "fs";
import * as path from "path";
import { loadFromPath } from "../cheerio.utils";

export interface MenuItem {
    name: string;
    type: string;
    id?: string;
    subsections: MenuItem[];
}

export interface FlattenedMenuItem {
    name: string;
    type: string;
    id?: string;
    parentId: string | null;
}

const INPUT_PATH = path.resolve(process.cwd(), 'src/manuel-specialistes-remuneration-acte.html');
const OUTPUT_PATH = path.resolve(process.cwd(), 'menu.json');

export function extractMenuItems(originalCheerioRoot: cheerio.Root) {
    const menuGauche = originalCheerioRoot('#menuGauche');
    if (!menuGauche.length) {
        throw new Error('No #menuGauche found in document');
    }

    // Find the main navigation ul
    const navUl = menuGauche.find('#nav');
    if (!navUl.length) {
        new Error('No #nav found in menuGauche');
    }

    const menu = parseMenuList(originalCheerioRoot, navUl, 1);

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(menu, null, 2), 'utf-8');

    return menu;
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

export function flattenMenuItems(menuItems: MenuItem[]): FlattenedMenuItem[] {
    const flattened: FlattenedMenuItem[] = [];

    function flattenRecursive(parentId: string | null, items: MenuItem[]) {
        for (const item of items) {
            // Add the current item (without subsections)
            const flatItem: FlattenedMenuItem = {
                name: item.name,
                type: item.type,
                id: item.id,
                parentId,
            };
            flattened.push(flatItem);

            // Recursively flatten subsections
            if (item.subsections.length > 0) {
                flattenRecursive(item.id ?? null, item.subsections);
            }
        }
    }

    flattenRecursive(null, menuItems);
    return flattened;
}

if (require.main === module) {
    if (!fs.existsSync(INPUT_PATH)) {
        throw new Error(`Input file not found: ${INPUT_PATH}`);
    }
    const $ = loadFromPath(INPUT_PATH);
    const menuItems = extractMenuItems($);
    const flat = flattenMenuItems(menuItems);
    console.log(`✅ Step 1 complete: ${flat.length} menu items → menu.json`);
}
