// apps/etl/src/5-extract-specs/index.ts
import * as fs from 'fs';
import * as path from 'path';
import { ChatAnthropic } from '@langchain/anthropic';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Runnable } from '@langchain/core/runnables';
import { BillingSpecResponseSchema, SpecResult } from '../../../shared/spec-schema';
import { SYSTEM_PROMPT } from './prompt';

interface Section {
    id?: string;
    parentId: string | null;
    name: string;
    content: (string | object)[];
}

const INPUT_PATH = path.resolve(process.cwd(), 'modified-content.json');
const OUTPUT_PATH = path.resolve(process.cwd(), 'specs.json');

function isTruncationError(err: any): boolean {
    const msg = String(err?.message ?? err);
    return msg.includes('Failed to parse') && msg.includes('specs');
}

async function invokeOnce(
    structuredModel: Runnable<any, any>,
    section: Section
): Promise<SpecResult[]> {
    const raw = await structuredModel.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(JSON.stringify(section)),
    ]);
    const { specs } = BillingSpecResponseSchema.parse(raw);
    return specs.map(spec => ({ status: 'success' as const, ...spec }));
}

async function processSection(
    smallModel: Runnable<any, any>,
    largeModel: Runnable<any, any>,
    section: Section
): Promise<SpecResult[]> {
    const sectionId = section.id ?? '';
    const sectionName = section.name ?? '';

    if (!section.content || section.content.length === 0) {
        return [];
    }

    try {
        return await invokeOnce(smallModel, section);
    } catch (err: any) {
        if (isTruncationError(err)) {
            console.log(`  ↻ retry with larger maxTokens (${sectionName})`);
            try {
                return await invokeOnce(largeModel, section);
            } catch (retryErr: any) {
                return [{
                    status: 'error',
                    sectionId,
                    sectionName,
                    errorMessage: retryErr?.message ?? String(retryErr),
                }];
            }
        }
        return [{
            status: 'error',
            sectionId,
            sectionName,
            errorMessage: err?.message ?? String(err),
        }];
    }
}

if (require.main === module) {
    require('dotenv').config();
    if (!fs.existsSync(INPUT_PATH)) {
        throw new Error(`Input file not found: ${INPUT_PATH} — run step 4 first`);
    }
    extractSpecs().catch(console.error);
}

export async function extractSpecs(): Promise<SpecResult[]> {
    if (!fs.existsSync(INPUT_PATH)) {
        throw new Error(`Input file not found: ${INPUT_PATH}`);
    }

    const limit = process.env.STEP5_LIMIT ? parseInt(process.env.STEP5_LIMIT, 10) : undefined;
    const concurrency = parseInt(process.env.STEP5_CONCURRENCY ?? '5', 10);
    const outputPath = limit
        ? path.resolve(process.cwd(), `specs.smoke-${limit}.json`)
        : OUTPUT_PATH;
    const progressPath = outputPath.replace(/\.json$/, '.progress.json');

    if (fs.existsSync(outputPath)) {
        console.log(`✅ ${path.basename(outputPath)} already exists, loading from cache`);
        return JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    }

    const allSections: Section[] = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
    const sections = limit ? allSections.slice(0, limit) : allSections;
    if (limit) {
        console.log(`🧪 Smoke mode: processing first ${sections.length} of ${allSections.length} sections`);
    }

    // Resume: load previously-processed sections from progress file
    const progress: Record<string, SpecResult[]> = fs.existsSync(progressPath)
        ? JSON.parse(fs.readFileSync(progressPath, 'utf-8'))
        : {};
    const alreadyDone = Object.keys(progress).length;
    if (alreadyDone > 0) {
        console.log(`⏭️  Resuming: ${alreadyDone} sections already done`);
    }

    const makeModel = (maxTokens: number, streaming: boolean) => new ChatAnthropic({
        model: 'claude-sonnet-4-6',
        temperature: 0,
        maxTokens,
        streaming,
        apiKey: process.env.ANTHROPIC_API_KEY,
        // @langchain/anthropic 0.3.34 doesn't recognize sonnet-4-6 and defaults
        // top_p / top_k to -1, which Anthropic rejects. Override via raw kwargs.
        invocationKwargs: { top_p: undefined, top_k: undefined },
    }).withStructuredOutput(BillingSpecResponseSchema, {
        name: 'extract_billing_specs',
    });

    const smallModel = makeModel(4096, false);
    // Large model uses streaming: Anthropic rejects non-streaming requests
    // estimated to take >10 minutes (happens with maxTokens: 32768 on dense sections).
    const largeModel = makeModel(32768, true);

    const total = sections.length;
    const todo = sections
        .map((section, idx) => ({ section, idx }))
        .filter(({ section }) => !(progressKey(section) in progress));
    console.log(`🚀 Processing ${todo.length} sections with concurrency ${concurrency}`);

    let completed = 0;
    async function worker() {
        while (todo.length > 0) {
            const next = todo.shift();
            if (!next) break;
            const { section, idx } = next;
            const key = progressKey(section);
            const sectionResults = await processSection(smallModel, largeModel, section);
            progress[key] = sectionResults;
            completed++;
            console.log(`[${alreadyDone + completed}/${total}] (orig #${idx + 1}) ${section.name}`);
            fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
        }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Flatten in original section order
    const results: SpecResult[] = [];
    let successCount = 0;
    let errorCount = 0;
    for (const section of sections) {
        const sectionResults = progress[progressKey(section)] ?? [];
        results.push(...sectionResults);
        for (const r of sectionResults) {
            if (r.status === 'success') successCount++;
            else errorCount++;
        }
    }

    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    fs.unlinkSync(progressPath);

    console.log(`\n✅ Done: ${successCount} specs, ${errorCount} errors`);
    console.log(`📄 Output: ${outputPath}`);

    return results;
}

function progressKey(section: Section): string {
    return section.id ?? `__noid__${section.name}`;
}
