import { SectionWithContent, SectionWithNormalizedContent } from "../3-group-content-by-section";
import fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { normalizeWhitespace } from "../normalize-whitespace";

const INPUT_PATH = path.resolve(process.cwd(), 'sectionsWithContent.json');
const OUTPUT_PATH = path.resolve(process.cwd(), 'modified-content.json');

export function sanitizeHtmlContent(sectionsWithContent: SectionWithContent[]): SectionWithNormalizedContent[] {
    if (fs.existsSync(OUTPUT_PATH)) {
        return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    }

    const modified: SectionWithNormalizedContent[] = sectionsWithContent.map(section => {
        return {
            ...section,
            content: normaliseContent(section.content)
        }
    });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(modified, null, 2), 'utf-8');

    return modified
}

function normaliseContent(content: string[]): (string | object)[] {
    let normalizedContent: (string | object)[] = []

    for (const chunk of content) {
        const $ = cheerio.load(chunk);
        const bodyChildren = $('body').contents().toArray();

        if (bodyChildren.length > 1) {
            throw new Error('Content has more than one root element');
        }

        const child = bodyChildren[0];

        if (!child) {
            continue; // Skip empty content
        } else if (child.type === 'text') {
            normalizedContent.push(child.data || '');
        } else if (child.type !== 'tag') {
            throw new Error('Content root is not a tag element');
        } else if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(child.name)) {
            normalizedContent.push(normalizeWhitespace($(child).text()));
        } else if (child.name === 'table') {

            const tableRowOrHeader = $(child)
                .find('tbody > tr, tbody > th')
                .filter((_, el) => $(el).parent().closest('table').is(child)) // Ignore nested tables
                .toArray();

            for (const row of tableRowOrHeader) {
                const FLOAT = String.raw`(?:\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+)[.,]\d+`;

                const rowRegex = new RegExp(
                    String.raw`^\s*(\d{5})\s+(.+?)\s+(${FLOAT})(?:\s+(${FLOAT}))?(?:\s+(\d+))?\s*$`,
                    "u"
                );
                const match = $(row).text().replace(/\u00a0/g, " ").trim().match(rowRegex);

                if (match) {
                    const [, code, description, raw_amount_facility, raw_amount_cabinet, raw_amount_r2] = match;

                    // Nettoyer la valeur (enlever les espaces dans "1 043,25")
                    const amount_facility = toNumber(raw_amount_facility);
                    const amount_cabinet = toNumber(raw_amount_cabinet);
                    const amount_r2 = raw_amount_r2 ? parseInt(raw_amount_r2, 10) : undefined;

                    normalizedContent.push({
                        code,
                        description: description.trim(),
                        amount_facility,
                        amount_cabinet,
                        amount_r2,
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
            normalizedContent = normalizedContent.concat(normaliseContent($(child).contents().toArray().map(c => $.html(c) || '')));
        }
    }

    return normalizedContent
}

const toNumber = (raw?: string) =>
    raw === undefined
        ? undefined
        : parseFloat(raw.replace(/[ \u00A0\u202F]/g, "").replace(",", "."));

if (require.main === module) {
    if (!fs.existsSync(INPUT_PATH)) {
        throw new Error(`Input file not found: ${INPUT_PATH} — run step 3 first`);
    }
    const sections: SectionWithContent[] = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
    const sanitized = sanitizeHtmlContent(sections);
    console.log(`✅ Step 4 complete: ${sanitized.length} sections → modified-content.json`);
}
