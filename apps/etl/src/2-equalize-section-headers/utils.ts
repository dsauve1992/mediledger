import * as cheerio from "cheerio";
import {normalizeWhitespace} from "../normalize-whitespace";

/**
 * Promote an element up the DOM until its direct parent is the given ancestor.
 * Preserves text order and optionally wraps the promoted element into another tag.
 *
 * @param $ - cheerio root
 * @param selector - CSS selector for the element to promote
 * @param ancestorSelector - CSS selector for the target ancestor
 * @param wrapperTag - optional wrapper tag (e.g. "div")
 * @param wrapperClass - optional class to add to wrapper
 */
export function promoteElementToAncestor(
    $: cheerio.CheerioAPI | cheerio.Root,
    selector: string,
    ancestorSelector: string,
    wrapperTag?: string,
    wrapperClass?: string
) {
    const $el = $(selector).first();
    if (!$el.length) return;

    const $ancestor = $el.closest(ancestorSelector).first();
    if (!$ancestor.length) return;

    // If wrapper requested, replace the element with wrapper containing its contents
    let $target: cheerio.Cheerio;
    if (wrapperTag) {
        $target = $(`<${wrapperTag}>`).append(normalizeWhitespace($el.text()).trim());
        if ($el.attr('id')) {
            const id = $el.attr('id')
            $target.attr('id', id!)
        }
        if (wrapperClass) $target.addClass(wrapperClass);
        $el.replaceWith($target);
    } else {
        $target = $el;
    }

    // Promote step by step until ancestor is direct parent
    while (!$target.parent().is($ancestor)) {
        promoteOneLevel($, $target);
        if (!$target.parent().length) break; // safety
    }
}

/**
 * Promote one element exactly one level up, preserving text order.
 */
function promoteOneLevel($: cheerio.CheerioAPI | cheerio.Root, $el: cheerio.Cheerio) {
    const $parent = $el.parent();
    const $gp = $parent.parent();
    if (!$gp.length) return;

    const $contents = $parent.contents();
    const idx = $contents.index($el);
    const $before = $contents.slice(0, idx);
    const $after = $contents.slice(idx + 1);

    const tag = ($parent.get(0) as any).tagName;
    const copyAttrs = (from: cheerio.Cheerio, to: cheerio.Cheerio) => {
        const attribs = (from.get(0) as any).attribs || {};
        for (const [k, v] of Object.entries(attribs)) {
            to.attr(k, v as string);
        }
    };

    let $left: cheerio.Cheerio | null = null;
    let $right: cheerio.Cheerio | null = null;

    if ($before.length) {
        $left = $(`<${tag}>`);
        copyAttrs($parent, $left);
        $left.append($before);
    }
    if ($after.length) {
        $right = $(`<${tag}>`);
        copyAttrs($parent, $right);
        $right.append($after);
    }

    if ($left) $parent.before($left);
    $parent.before($el);
    if ($right) $parent.before($right);

    $parent.remove();
}

