import path from "path";
import fs from "fs";
import * as cheerio from 'cheerio';

export function loadFromPath(filePath: string) {
    const absolutePath = path.resolve(filePath);
    const htmlContent = fs.readFileSync(absolutePath, 'utf-8');
    return cheerio.load(htmlContent);
}