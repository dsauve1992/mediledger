import cheerio from "cheerio";
import { FlattenedMenuItem, MenuItem, extractMenuItems, flattenMenuItems } from "../1-extract-structure-from-menu/menu-items";
import fs from "fs";
import * as path from "path";
import { loadFromPath } from "../cheerio.utils";
import { promoteElementToAncestor } from "./utils";

const INPUT_HTML_PATH = path.resolve(process.cwd(), 'src/manuel-specialistes-remuneration-acte.html');
const INPUT_MENU_PATH = path.resolve(process.cwd(), 'menu.json');
const OUTPUT_PATH = path.resolve(process.cwd(), 'modified-raw-content.html');

export function getDocumentWithMainSectionAsDirectChildren($: cheerio.Root, flattenedItems: FlattenedMenuItem[]) {
    if (fs.existsSync(OUTPUT_PATH)) {
        console.log('Modified raw content file already exists. Skipping reconstruction.');
        return fs.readFileSync(OUTPUT_PATH, 'utf-8');
    }
    const modifiedContenuSection = grabMainSectionsToTheRoot($, flattenedItems);
    fs.writeFileSync(OUTPUT_PATH, modifiedContenuSection, 'utf-8');
    return modifiedContenuSection;
}

function grabMainSectionsToTheRoot(
    $: cheerio.Root,
    flattenedItems: FlattenedMenuItem[]
): string {
    for (const [i, item] of flattenedItems.entries()) {
        console.log(
            `Extracted content (${i + 1}/${flattenedItems.length}) \t ${item.name} \t (ID: ${item.id})`
        );
        promoteElementToAncestor($, `#${item.id}`, "#contenu", 'div', 'medi-ledger-section');
    }
    return $.html();
}

if (require.main === module) {
    if (!fs.existsSync(INPUT_HTML_PATH)) {
        throw new Error(`Input file not found: ${INPUT_HTML_PATH}`);
    }
    if (!fs.existsSync(INPUT_MENU_PATH)) {
        throw new Error(`Input file not found: ${INPUT_MENU_PATH} — run step 1 first`);
    }
    const $ = loadFromPath(INPUT_HTML_PATH);
    const menuItems: MenuItem[] = JSON.parse(fs.readFileSync(INPUT_MENU_PATH, 'utf-8'));
    const flat = flattenMenuItems(menuItems);
    getDocumentWithMainSectionAsDirectChildren($, flat);
    console.log('✅ Step 2 complete: normalized headers → modified-raw-content.html');
}
