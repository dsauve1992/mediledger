import cheerio from "cheerio";
import {MenuItem} from "../1-extract-structure-from-menu/menu-items";
import fs from "fs";
import {extractNodesPreserveStructure} from "./utils";

export function getDocumentWithMainSectionAsDirectChildren($: cheerio.Root, flattenedItems: MenuItem[]) {
    if (fs.existsSync('./modified-raw-content.html')) {
        console.log('Modified raw content file already exists. Skipping reconstruction.');

        return fs.readFileSync('./modified-raw-content.html', 'utf-8');
    }
    const modifiedContenuSection = grabMainSectionsToTheRoot($, flattenedItems);
    fs.writeFileSync('./modified-raw-content.html', modifiedContenuSection, 'utf-8');

    return modifiedContenuSection
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