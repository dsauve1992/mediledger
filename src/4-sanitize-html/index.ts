import {SectionWithContent} from "../3-group-content-by-section";
import fs from "fs";
import * as cheerio from "cheerio";
import {normalizeWhitespace} from "../normalize-whitespace";

export function sanitizeHtmlContent(sectionsWithContent: SectionWithContent[]) {
    const modified = sectionsWithContent.map(section => {
        return {
            ...section,
            content: normaliseContent(section.content)
        }
    });

    fs.writeFileSync('./modified-content.json', JSON.stringify(modified, null, 2), 'utf-8');

    return modified
}

function normaliseContent(content: string[]): (string | object)[] {
    let normalizedContent: (string | object)[] = []

    for (const chunk of content) {
        const $ = cheerio.load(chunk);
        const bodyChildren = $('body').children().toArray();

        if (bodyChildren.length > 1) {
            throw new Error('Content has more than one root element');
        }

        const child = bodyChildren[0];

        if (child.type === 'text') {
            normalizedContent.push(child.data || '');
        } else if (child.type !== 'tag') {
            throw new Error('Content root is not a tag element');
        } else if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(child.name)) {
            normalizedContent.push(normalizeWhitespace($(child).text()));
        } else if (['ul', 'ol'].includes(child.name)) {
            normalizedContent.push($.html(child));
        } else if (child.name === 'table') {

            const tableRowOrHeader = $(child)
                .find('tr, th')
                .filter((_, el) => $(el).parent().closest('table').is(child)) // Ignore nested tables
                .toArray();

            for (const row of tableRowOrHeader) {
                const rowRegex = /^\s*(\d{5})\s+(.+?)\s+([\d.,\s]+?)(?:\s+(\d+))?\s*$/;

                //check if row matches the regex
                const rowText = $(row).text().trim();
                const match = rowText.match(rowRegex);
                if (match) {
                    const [, code, description, rawValue, rawExtra] = match;

                    // Nettoyer la valeur (enlever les espaces dans "1 043,25")
                    const value = parseFloat(rawValue.replace(/\s/g, "").replace(",", "."));
                    const extra = rawExtra ? parseInt(rawExtra, 10) : undefined;

                    normalizedContent.push({
                        code,
                        description: description.trim(),
                        value,
                        extra,
                    } as any);
                } else {
                    // If it doesn't match, we can still add the raw HTML
                    const stringifiedRow = $(row).text().trim();
                    if (stringifiedRow) {
                        const normalizedWhitespace = normalizeWhitespace(stringifiedRow);
                        normalizedContent.push(normalizedWhitespace);
                    }
                }
            }

        } else {
            normalizedContent = normalizedContent.concat(normaliseContent($(child).children().toArray().map(c => $.html(c) || '')));
        }
    }

    return normalizedContent
}