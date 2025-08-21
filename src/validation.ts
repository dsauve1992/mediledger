import * as diff from "diff";
import {normalizeWhitespace} from "./normalize-whitespace";

export function isTextEqualIgnoringWhitespace(a: string, b: string): boolean {
    const changes = diff.diffWords(a, b);

    return !changes.some(change => change.added || change.removed);
}

export function compareString(originalText: string, extractedText: string) {

    const normalizedOriginal = normalizeWhitespace(originalText);
    const normalizedExtracted = normalizeWhitespace(extractedText);

    // Compare the normalized versions
    const isIdentical = normalizedOriginal === normalizedExtracted
    console.log(`Content identical (normalized): ${isIdentical ? '✅ YES' : '❌ NO'}`);

    if (!isIdentical) {
        console.log('\n=== DIFFERENCES FOUND ===');
        console.log('Normalized original text starts with:', normalizedOriginal.substring(0, 200));
        console.log('Normalized extracted text starts with:', normalizedExtracted.substring(0, 200));
        // Find the first difference
        const minLength = Math.min(normalizedOriginal.length, normalizedExtracted.length);
        for (let i = 0; i < minLength; i++) {
            if (normalizedOriginal[i] !== normalizedExtracted[i]) {
                console.log(`First difference at position ${i}:`);
                console.log(`Original: "${normalizedOriginal.substring(i-5, i + 50)}"`);
                console.log(`Extracted: "${normalizedExtracted.substring(i-5, i + 50)}"`);
                break;
            }
        }
    } else {
        console.log('🎉 All content successfully extracted!');
    }
}