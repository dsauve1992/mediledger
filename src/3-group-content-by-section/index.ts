import cheerio from "cheerio";
import {FlattenedMenuItem, MenuItem} from "../1-extract-structure-from-menu/menu-items";
import fs from "fs";

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

export function extractSectionsWithContent(modifiedCheerioRoot$: cheerio.Root, flattenedItems: FlattenedMenuItem[]): SectionWithContent[] {
    if (fs.existsSync('./sectionsWithContent.json')) {
        return JSON.parse(fs.readFileSync('./sectionsWithContent.json', "utf-8"));
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

    fs.writeFileSync('./sectionsWithContent.json', JSON.stringify(sectionsWithContent, null, 2), 'utf-8');
    return sectionsWithContent;
}