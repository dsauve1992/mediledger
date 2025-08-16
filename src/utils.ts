import * as cheerio from 'cheerio';
import {TEST_CASES} from "./test-cases";
import format from "html-format";


function getParentTagName(target: cheerio.Cheerio) {
    const immediateParent = target.parent();
    const parentElement = immediateParent[0];
    if (parentElement.type !== 'tag') {
        throw new Error('Immediate parent is not a tag element');
    }
    const parentTagName = parentElement.tagName;
    return parentTagName;
}

const MAX_ITERATIONS = 20; // Prevent infinite loops


export function extractNodesPreserveStructure(
    html: string,
    parentSelector: string,
    targetSelector: string
): string {
    let modifiedHtml = html;
    let iteration = 0;

    do {
        const $ = cheerio.load(modifiedHtml, {xmlMode: false});

        const parent = $(parentSelector);
        if (!parent.length) throw new Error(`Parent "${parentSelector}" not found`);

        // Find the target node
        const target = $(targetSelector);
        if (!target.length) throw new Error(`Target "${targetSelector}" not found`);
        const targetString = $.html(target)

        // Check if target is already a direct child of parent
        if (target.parent().is(parent)) {
            // Return the original HTML without html/head/body tags
            return $.html($('body > *'));
        }

        // Get the immediate parent of the target
        const parentTagName = getParentTagName(target);

        modifiedHtml = modifiedHtml.replace(targetString, `</${parentTagName}>${targetString}<${parentTagName}>`);
    }while(++iteration < MAX_ITERATIONS)

    return modifiedHtml
}
