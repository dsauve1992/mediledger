import cheerio from "cheerio";
import {MenuItem} from "../1-extract-structure-from-menu/menu-items";
import fs from "fs";

export interface SectionWithContent {
    id?: string;
    name: string;
    content: string[];
}

export interface SectionWithNormalizedContent {
    id?: string;
    name: string;
    content: (string | object)[];
}

export function extractSectionsWithContent(modifiedCheerioRoot$: cheerio.Root, $: cheerio.Root, flattenedItems: MenuItem[]): SectionWithContent[] {
    if (fs.existsSync('./sectionsWithContent.json')) {
        return JSON.parse(fs.readFileSync('./sectionsWithContent.json', "utf-8"));
    }

    const sectionsWithContent: SectionWithContent[] = [];

    let currentSection: SectionWithContent = {id: '', name: '', content: []};

    modifiedCheerioRoot$('#contenu > *').each((_, element) => {
        const $element = $(element);
        const id = $element.attr('id');
        const name = $element.text()
        const content = $.html(element) || '';

        if (id && flattenedItems.some(item => item.id === id)) {
            if (currentSection) {
                sectionsWithContent.push(currentSection);
            }

            currentSection = {id, name, content: []};
        } else if (currentSection) {
            currentSection.content.push(content);
        }
    })

    sectionsWithContent.push(currentSection);

    fs.writeFileSync('./sectionsWithContent.json', JSON.stringify(sectionsWithContent, null, 2), 'utf-8');
    return sectionsWithContent;
}