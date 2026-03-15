import cheerio from "cheerio";
import { FlattenedMenuItem, MenuItem, flattenMenuItems } from "../1-extract-structure-from-menu/menu-items";
import fs from "fs";
import * as path from "path";

export interface SectionWithContent {
    id?: string;
    parentId: string | null;
    name: string;
    content: string[];
}

export interface SectionWithNormalizedContent {
    id?: string;
    parentId: string | null;
    name: string;
    content: (string | object)[];
}

const INPUT_HTML_PATH = path.resolve(process.cwd(), 'modified-raw-content.html');
const INPUT_MENU_PATH = path.resolve(process.cwd(), 'menu.json');
const OUTPUT_PATH = path.resolve(process.cwd(), 'sectionsWithContent.json');

export function extractSectionsWithContent(modifiedCheerioRoot$: cheerio.Root, flattenedItems: FlattenedMenuItem[]): SectionWithContent[] {
    if (fs.existsSync(OUTPUT_PATH)) {
        return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
    }

    const sectionsWithContent: SectionWithContent[] = [];

    let currentSection: SectionWithContent = {parentId: null, id: '', name: '', content: []};

    modifiedCheerioRoot$('#contenu > *').each((_, element) => {
        const $element = modifiedCheerioRoot$(element);
        const id = $element.attr('id');
        const name = $element.text()
        const content = modifiedCheerioRoot$.html(element) || '';

        const matchingFlattenedItem = flattenedItems.find(item => item.id === id);

        if (id && !!matchingFlattenedItem) {
            console.log(`Found menu item ${matchingFlattenedItem?.name}`)
            if (currentSection) {
                sectionsWithContent.push(currentSection);
            }
            currentSection = {id, parentId: matchingFlattenedItem.parentId, name, content: []};
        } else if (currentSection) {
            currentSection.content.push(content);
        }
    })

    sectionsWithContent.push(currentSection);

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sectionsWithContent, null, 2), 'utf-8');
    return sectionsWithContent;
}

if (require.main === module) {
    if (!fs.existsSync(INPUT_HTML_PATH)) {
        throw new Error(`Input file not found: ${INPUT_HTML_PATH} — run step 2 first`);
    }
    if (!fs.existsSync(INPUT_MENU_PATH)) {
        throw new Error(`Input file not found: ${INPUT_MENU_PATH} — run step 1 first`);
    }
    const menuItems: MenuItem[] = JSON.parse(fs.readFileSync(INPUT_MENU_PATH, 'utf-8'));
    const flat = flattenMenuItems(menuItems);
    const $ = cheerio.load(fs.readFileSync(INPUT_HTML_PATH, 'utf-8'));
    const sections = extractSectionsWithContent($, flat);
    console.log(`✅ Step 3 complete: ${sections.length} sections → sectionsWithContent.json`);
}
