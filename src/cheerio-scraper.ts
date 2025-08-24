import * as cheerio from 'cheerio';
import {compareString} from "./validation";
import {extractMenuItems, flattenMenuItems} from "./1-extract-structure-from-menu/menu-items";
import {loadFromPath} from "./cheerio.utils";
import {getDocumentWithMainSectionAsDirectChildren} from "./2-equalize-section-headers";
import {extractSectionsWithContent} from "./3-group-content-by-section";
import {sanitizeHtmlContent} from "./4-sanitize-html";

interface Document {
    content: (DocumentSection | RawElement)[];
}

interface DocumentSection {
    name: string;
    type: 'section';
    id?: string;
    subsections: (DocumentSection | RawElement)[];
}

interface RawElement {
    type: 'raw';
    content: string;
}

async function main() {
    const filePath = './src/manuel-specialistes-remuneration-acte.html';

    console.log('=== STARTING SCRAPER ===');
    console.log(`Scraping local file: ${filePath}`);
    const $ = loadFromPath(filePath);

    parseDocument($);
}

function parseDocument(originalCheerioRoot: cheerio.Root) {
    const originalContenuText = getContenuString(originalCheerioRoot)

    const menuItems = extractMenuItems(originalCheerioRoot);
    const flattenedItems = flattenMenuItems(menuItems);

    const modifiedDocument = getDocumentWithMainSectionAsDirectChildren(originalCheerioRoot, flattenedItems);
    console.log('Validate step 1')
    compareString(originalContenuText, getContenuString(cheerio.load(modifiedDocument)));

    const sectionsWithContent = extractSectionsWithContent(cheerio.load(modifiedDocument), originalCheerioRoot, flattenedItems);

    const sectionWithContentText = sectionsWithContent.reduce((acc, section) => {
        return acc + section.name + '\n' + cheerio.load(section.content.join(' ')).root().text() + '\n';
    }, '')

    console.log('Validate step 2')
    compareString(originalContenuText, sectionWithContentText);


    const sanitizedVersion = sanitizeHtmlContent(sectionsWithContent);
    const sanitizedVersionText = sanitizedVersion.reduce((acc:string, section) => {
        return acc + section.name + ' ' + section.content.map(content => {
            if (typeof content === 'string') {
                return content;
            } else {
                return `${(content as any).code} ${(content as any).description} ${formatAmount((content as any).amount_facility)}${(content as any).amount_cabinet ? ' ' + formatAmount((content as any).amount_cabinet) : ''}${(content as any).amount_r2 ? ' ' + (content as any).amount_r2 : ''}`;
            }
        }).join(' ') + '\n';
    }, '')


    compareString(sectionWithContentText, sanitizedVersionText)
}

function formatAmount(amount: number): string {
    return amount.toLocaleString('fr-FR', {
        style: 'decimal',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}


function getContenuString($: cheerio.Root) {
    const originalContenuNode = $('#contenu');

    if (!originalContenuNode.length) {
        throw new Error('❌ No #contenu node found');
    }

    return originalContenuNode.text().trim();
}

// Run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}
