export const normalizeWhitespace = (text: string): string => {
    return text
        .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
        .replace(/\n+/g, ' ')   // Replace newlines with spaces
        .replace(/\t/g, ' ')   // Replace tabs with spaces
        .replace(/—/g, '-')    // Replace em dash with regular dash
        .replace(/"/g, '"')    // Replace smart quotes with regular quotes
        .replace(/È/g, 'E')   // Replace È with E
        .replace(/É/g, 'E')   // Replace É with E
        .replace(/Ê/g, 'E')   // Replace Ê with E
        .replace(/Ë/g, 'E')   // Replace Ë with E
        .replace(/À/g, 'A')   // Replace À with A
        .replace(/Â/g, 'A')   // Replace Â with A
        .replace(/Ä/g, 'A')   // Replace Ä with A
        .replace(/Ù/g, 'U')   // Replace Ù with U
        .replace(/Û/g, 'U')   // Replace Û with U
        .replace(/Ü/g, 'U')   // Replace Ü with U
        .replace(/Î/g, 'I')   // Replace Î with I
        .replace(/Ï/g, 'I')   // Replace Ï with I
        .replace(/Ô/g, 'O')   // Replace Ô with O
        .replace(/Œ/g, 'OE')  // Replace Œ with OE
        .replace(/œ/g, 'oe')  // Replace œ with oe
        .trim();               // Remove leading/trailing whitespace
};
