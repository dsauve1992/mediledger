import * as cheerio from 'cheerio';


const MAX_ITERATIONS = 20;

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
        if (!parent.length) {
            throw new Error(`Parent "${parentSelector}" not found`);
        }

        const target = $(targetSelector);
        if (!target.length) {
            throw new Error(`Target "${targetSelector}" not found`);
        }
        if (target.parent().is(parent)) {

            return $.html($('body > *'));
        }
        const parentTagName = getParentTagName(target);

        const targetString = $.html(target)
        modifiedHtml = modifiedHtml.replace(targetString, `</${parentTagName}>${targetString}<${parentTagName}>`);
    } while(++iteration < MAX_ITERATIONS)

    return modifiedHtml
}


function getParentTagName(target: cheerio.Cheerio) {
    const parentElement = target.parent()[0];

    if (parentElement.type !== 'tag') {
        throw new Error('Immediate parent is not a tag element');
    }

    return parentElement.tagName;
}
