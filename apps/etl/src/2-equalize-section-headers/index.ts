import cheerio from "cheerio";
import {FlattenedMenuItem, MenuItem} from "../1-extract-structure-from-menu/menu-items";
import fs from "fs";
import {promoteElementToAncestor} from "./utils";

export function getDocumentWithMainSectionAsDirectChildren($: cheerio.Root, flattenedItems: FlattenedMenuItem[]) {
    if (fs.existsSync('./modified-raw-content.html')) {
        console.log('Modified raw content file already exists. Skipping reconstruction.');

        return fs.readFileSync('./modified-raw-content.html', 'utf-8');
    }
    const modifiedContenuSection = grabMainSectionsToTheRoot($, flattenedItems);
    fs.writeFileSync('./modified-raw-content.html', modifiedContenuSection, 'utf-8');

    return modifiedContenuSection
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