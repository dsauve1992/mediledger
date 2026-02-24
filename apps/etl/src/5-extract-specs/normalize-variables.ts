// apps/etl/src/5-extract-specs/normalize-variables.ts
import * as fs from 'fs';
import * as path from 'path';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { SpecResult, LogicNode } from './spec-schema';

const SPECS_PATH = path.resolve(process.cwd(), 'specs.json');
const REGISTRY_PATH = path.resolve(process.cwd(), 'variable-registry.json');
const NORMALIZED_PATH = path.resolve(process.cwd(), 'specs-normalized.json');

/** Recursively collect all variable names from CONTEXT and IN_SET nodes */
function collectVariables(node: LogicNode, acc: Set<string>): void {
    if (!node || typeof node !== 'object') return;
    if ('op' in node) {
        if ((node.op === 'CONTEXT' || node.op === 'IN_SET') && 'variable' in node) {
            acc.add((node as any).variable);
        }
        if ('children' in node && Array.isArray((node as any).children)) {
            for (const child of (node as any).children) {
                collectVariables(child, acc);
            }
        }
    }
}

/** Recursively rewrite variable names using the registry */
function applyRegistry(node: any, registry: Record<string, string>): any {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(n => applyRegistry(n, registry));
    const result: any = {};
    for (const [k, v] of Object.entries(node)) {
        if (k === 'variable' && typeof v === 'string') {
            result[k] = registry[v] ?? v;
        } else if (typeof v === 'object' && v !== null) {
            result[k] = applyRegistry(v, registry);
        } else {
            result[k] = v;
        }
    }
    return result;
}

async function buildRegistry(
    variables: string[],
    model: ChatOpenAI
): Promise<Record<string, string>> {
    const prompt = `You are a medical billing ontology expert.
Below is a list of variable names extracted from RAMQ billing rules by an LLM.
They represent the same concepts but may have different names (e.g., "is_hospitalized", "patient_hospitalized", "hospitalized").

Your task: group semantically equivalent variables and assign one canonical snake_case name per group.
Return ONLY a JSON object mapping each original name to its canonical name. No explanation, no markdown.

Variables:
${JSON.stringify(variables, null, 2)}

Output format:
{ "original_name": "canonical_name", ... }`;

    const response = await model.invoke([
        new SystemMessage('You are a medical billing ontology expert. Respond with JSON only.'),
        new HumanMessage(prompt),
    ]);

    const raw = response.content as string;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in normalization response');
    return JSON.parse(jsonMatch[0]);
}

export async function normalizeVariables(): Promise<void> {
    if (!fs.existsSync(SPECS_PATH)) {
        throw new Error(`specs.json not found — run extractSpecs first`);
    }

    if (fs.existsSync(NORMALIZED_PATH) && fs.existsSync(REGISTRY_PATH)) {
        console.log('✅ Normalized specs already exist, skipping');
        return;
    }

    const results: SpecResult[] = JSON.parse(fs.readFileSync(SPECS_PATH, 'utf-8'));

    // Collect all variable names from successful specs
    const variables = new Set<string>();
    for (const result of results) {
        if (result.status === 'success' && result.logic) {
            collectVariables(result.logic as LogicNode, variables);
        }
    }

    const variableList = Array.from(variables);
    console.log(`Found ${variableList.length} unique CONTEXT/IN_SET variables`);

    if (variableList.length === 0) {
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify({}, null, 2));
        fs.writeFileSync(NORMALIZED_PATH, JSON.stringify(results, null, 2));
        return;
    }

    const model = new ChatOpenAI({
        model: 'gpt-4o',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
    });

    const registry = await buildRegistry(variableList, model);
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
    console.log(`📄 variable-registry.json written`);

    // Apply registry to all specs
    const normalized = results.map(result => {
        if (result.status !== 'success' || !result.logic) return result;
        return { ...result, logic: applyRegistry(result.logic, registry) };
    });

    fs.writeFileSync(NORMALIZED_PATH, JSON.stringify(normalized, null, 2));
    console.log(`📄 specs-normalized.json written`);
}
