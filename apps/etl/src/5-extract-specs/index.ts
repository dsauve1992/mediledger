// apps/etl/src/5-extract-specs/index.ts
import * as fs from 'fs';
import * as path from 'path';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BillingSpecArraySchema, SpecResult } from './spec-schema';
import { SYSTEM_PROMPT } from './prompt';

interface Section {
    id?: string;
    parentId: string | null;
    name: string;
    content: (string | object)[];
}

const INPUT_PATH = path.resolve(process.cwd(), 'modified-content.json');
const OUTPUT_PATH = path.resolve(process.cwd(), 'specs.json');

function extractJson(raw: string): string {
    // Strip markdown fences if present
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    // Fall back to first [...] block
    const arr = raw.match(/\[[\s\S]*\]/);
    if (arr) return arr[0];
    throw new Error('No JSON array found in LLM response');
}

async function processSection(
    model: ChatOpenAI,
    section: Section
): Promise<SpecResult[]> {
    const sectionId = section.id ?? '';
    const sectionName = section.name ?? '';

    if (!section.content || section.content.length === 0) {
        return [];
    }

    let rawLLMResponse = '';
    try {
        const response = await model.invoke([
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(JSON.stringify(section)),
        ]);

        rawLLMResponse = response.content as string;
        const jsonStr = extractJson(rawLLMResponse);
        const parsed = JSON.parse(jsonStr);

        const validation = BillingSpecArraySchema.safeParse(parsed);
        if (!validation.success) {
            return [{
                status: 'validation_error',
                sectionId,
                sectionName,
                rawLLMResponse,
                zodError: validation.error,
            }];
        }

        return validation.data.map(spec => ({ status: 'success' as const, ...spec }));

    } catch (err: any) {
        return [{
            status: 'error',
            sectionId,
            sectionName,
            errorMessage: err?.message ?? String(err),
        }];
    }
}

export async function extractSpecs(): Promise<SpecResult[]> {
    if (!fs.existsSync(INPUT_PATH)) {
        throw new Error(`Input file not found: ${INPUT_PATH}`);
    }

    // Cache: skip if output already exists
    if (fs.existsSync(OUTPUT_PATH)) {
        console.log(`✅ specs.json already exists, loading from cache`);
        return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    }

    const sections: Section[] = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));

    const model = new ChatOpenAI({
        model: 'gpt-4o',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
    });

    const results: SpecResult[] = [];
    let successCount = 0;
    let validationErrorCount = 0;
    let errorCount = 0;

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        console.log(`[${i + 1}/${sections.length}] ${section.name}`);

        const sectionResults = await processSection(model, section);
        results.push(...sectionResults);

        for (const r of sectionResults) {
            if (r.status === 'success') successCount++;
            else if (r.status === 'validation_error') validationErrorCount++;
            else errorCount++;
        }

        // Rate limiting: 1s delay between calls
        if (i < sections.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

    console.log(`\n✅ Done: ${successCount} specs, ${validationErrorCount} validation errors, ${errorCount} errors`);
    console.log(`📄 Output: ${OUTPUT_PATH}`);

    return results;
}
