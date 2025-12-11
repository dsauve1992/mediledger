/* eslint-disable no-console */
// pipeline.ts — UL incrémental + extraction Proto-IR + fusion/proposition
// Run: OPENAI_API_KEY=... npx ts-node pipeline.ts

import "dotenv/config";
import { z } from "zod";
import fs from "fs";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import path from "path";

/* =========================
 * 1) Types & schémas Zod
 * ========================= */

const Hypo = z.object({
    tag: z.string(),
    value: z.string(),
    conf: z.number().min(0).max(1),
});
type Hypo = z.infer<typeof Hypo>;

const Evidence = z.object({
    ruleId: z.string(),
    quote: z.string(),
});

const ProtoIRSchema = z.object({
    ruleId: z.string(),
    title: z.string().optional(),
    operator_name: z.string(),
    arguments: z.record(z.any()).default({}),
    evidence: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
    ambiguities: z.array(z.string()).default([]),

    univers_raw: z.array(z.string()).default([]),
    univers_hypotheses: z.array(Hypo).default([]),

    portee_raw: z.array(z.string()).default([]),
    portee_hypotheses: z.array(Hypo).default([]),

    compteur_raw: z.array(z.string()).default([]),
    compteur_hypotheses: z.array(Hypo).default([]),

    provenance: z.object({
        sourcePath: z.string().optional(),
    }).default({}),
});
type ProtoIR = z.infer<typeof ProtoIRSchema>;

// Propositions UL renvoyées par le LLM (toutes ADDITIVES)
const OperatorProposal = z.object({
    label_fr: z.string(),
    signature: z.object({
        requiredArgs: z.array(z.string()).default([]),
        optionalArgs: z.array(z.string()).default([]),
    }),
    examples_fr: z.array(z.string()).default([]),
    evidence: z.array(Evidence).default([]),
    confidence: z.number().min(0).max(1).default(0.6),
    introduced_in_ruleId: z.string(),
});
type OperatorProposal = z.infer<typeof OperatorProposal>;

const DimensionProposal = z.object({
    label_fr: z.string(),
    values: z.array(z.object({ label_fr: z.string() })).default([]),
    evidence: z.array(Evidence).default([]),
    confidence: z.number().min(0).max(1).default(0.6),
    introduced_in_ruleId: z.string(),
});
type DimensionProposal = z.infer<typeof DimensionProposal>;

const EntityProposal = z.object({
    label_fr: z.string(),
    evidence: z.array(Evidence).default([]),
    confidence: z.number().min(0).max(1).default(0.6),
    introduced_in_ruleId: z.string(),
});
type EntityProposal = z.infer<typeof EntityProposal>;

// ⚠️ On ajoute introduced_in_ruleId pour unifier les proposals et éviter le mismatch
const MappingProposal = z.object({
    raw_phrase: z.string(), // "à la même séance"
    canonical: z.object({
        kind: z.enum(["operator", "dimension", "entity", "value"]),
        // pour kind "value", donner la dimension et la valeur par libellé
        label_fr: z.string(),
        value_label_fr: z.string().optional(),
    }),
    confidence: z.number().min(0).max(1).default(0.6),
    evidence: z.array(Evidence).default([]),
    introduced_in_ruleId: z.string(),
});
type MappingProposal = z.infer<typeof MappingProposal>;

const ULProposals = z.object({
    operators: z.array(OperatorProposal).default([]),
    dimensions: z.array(DimensionProposal).default([]),
    entities: z.array(EntityProposal).default([]),
    mappings: z.array(MappingProposal).default([]),
});
type ULProposals = z.infer<typeof ULProposals>;

const CodeActeSchema = z.object({
    code: z.string().optional(),
    description: z.string().optional(),
    amount_facility: z.number().nullable().optional(),
    amount_r2: z.number().nullable().optional(),
    amount_cabinet: z.number().nullable().optional(),
});

const SubRuleInputSchema = z.object({
    id: z.string(),
    text: z.string().default(""),
    conditions: z.array(z.string()).default([]),
    avis: z.array(z.string()).default([]),
    codes: z.array(CodeActeSchema).optional(), // ignoré par la suite
});

const RuleInputSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    subrules: z.array(SubRuleInputSchema).optional(),
    codes: z.array(CodeActeSchema).optional(), // ignoré par la suite
});

const DocumentSchema = z.array(
    z.object({
        name: z.string(),
        rules: z.array(RuleInputSchema),
    })
);

type DocumentInput = z.infer<typeof DocumentSchema>;

function flattenDocumentToSubrules(doc: DocumentInput): { ruleId: string; text: string }[] {
    const out: { ruleId: string; text: string }[] = [];
    for (const section of doc) {
        for (const rule of section.rules) {
            // 3.1 Sous-règles explicites
            if (rule.subrules && rule.subrules.length) {
                for (const sr of rule.subrules) {
                    const parts: string[] = [];
                    // Contexte minimal utile (améliore l'extraction sans imposer de modèle)
                    parts.push(`Titre de règle: ${rule.title}`);
                    if (sr.text?.trim()) parts.push(sr.text.trim());
                    if (sr.conditions?.length) {
                        for (const c of sr.conditions) parts.push(`Condition: ${c}`);
                    }
                    if (sr.avis?.length) {
                        for (const a of sr.avis) parts.push(`Avis: ${a}`);
                    }
                    const text = parts.join("\n");
                    const rid = sr.id || rule.id; // sr.id type "113488.1" dans tes exemples
                    out.push({ ruleId: rid, text });
                }
            } else if (rule.description && rule.description.trim()) {
                // 3.2 Fallback: si aucune sous-règle, on passe la description de la règle
                const parts = [`Titre de règle: ${rule.title}`, rule.description.trim()];
                out.push({ ruleId: rule.id, text: parts.join("\n") });
            }
        }
    }
    return out;
}


// --- UL accepté/proposé (ids stables côté accepted)
type ID = string;

type OperatorDef = {
    id: ID;
    label_fr: string;
    signature: { requiredArgs: string[]; optionalArgs: string[] };
    examples_fr: string[];
    evidence: z.infer<typeof Evidence>[];
    status: "accepted" | "deprecated";
    introduced_in_ruleId: string;
};

type Dimension = {
    id: ID; // "time_window"
    label_fr: string;
    values: { id: ID; label_fr: string }[]; // "same_session", "same_day"
    evidence: z.infer<typeof Evidence>[];
    introduced_in_ruleId: string;
};

type Entity = {
    id: ID;
    label_fr: string;
    evidence: z.infer<typeof Evidence>[];
    introduced_in_ruleId: string;
};

type Mapping = {
    raw_phrase: string;
    canonical: {
        kind: "operator" | "dimension" | "entity" | "value";
        id: ID;        // résolu vers accepted
        valueId?: ID;  // si kind === "value"
    };
    confidence: number;
    evidence: z.infer<typeof Evidence>[];
};

type Stats = { seenInRules: number; totalConf: number; avgConf: number };
type ProposedWithStats<T> = T & { stats: Stats };

type UL = {
    version: string;
    operators: {
        accepted: OperatorDef[];
        proposed: ProposedWithStats<OperatorProposal>[];
        deprecated: OperatorDef[];
    };
    dimensions: {
        accepted: Dimension[];
        proposed: ProposedWithStats<DimensionProposal>[];
    };
    entities: {
        accepted: Entity[];
        proposed: ProposedWithStats<EntityProposal>[];
    };
    mappings: {
        accepted: Mapping[];
        proposed: ProposedWithStats<MappingProposal>[];
    };
};

const initialUL: UL = {
    version: "0.0.1",
    operators: { accepted: [], proposed: [], deprecated: [] },
    dimensions: { accepted: [], proposed: [] },
    entities: { accepted: [], proposed: [] },
    mappings: { accepted: [], proposed: [] },
};

/* =========================
 * 2) Utilitaires
 * ========================= */

const THRESHOLDS = {
    kOccurrences: 3,     // ≥ 3 règles distinctes
    minAvgConfidence: 0.75,
    synonymSim: 0.88,    // similarité (trigramme) pour considérer un synonyme
};

function slugify(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD").replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

// similarité trigrammes simple (évite lib externe)
function similarity(a: string, b: string): number {
    const tri = (t: string) => {
        const s = `  ${t.toLowerCase()} `;
        const g: Record<string, number> = {};
        for (let i = 0; i < s.length - 2; i++) {
            const k = s.slice(i, i + 3);
            g[k] = (g[k] || 0) + 1;
        }
        return g;
    };
    const A = tri(a), B = tri(b);
    const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
    let dot = 0, na = 0, nb = 0;
    for (const k of keys) {
        const va = A[k] || 0, vb = B[k] || 0;
        dot += va * vb; na += va * va; nb += vb * vb;
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// upsert générique (plus de contrainte "introduced_in_ruleId" pour le type)
function upsertProposed<T extends { confidence?: number }>(
    list: ProposedWithStats<T>[],
    item: T,
    key: (x: T) => string
) {
    const k = key(item);
    const idx = list.findIndex(p => key(p as any) === k);
    const conf = item.confidence ?? 0.6;
    if (idx >= 0) {
        const cur = list[idx];
        cur.stats.seenInRules += 1;
        cur.stats.totalConf += conf;
        cur.stats.avgConf = cur.stats.totalConf / cur.stats.seenInRules;
        // merge naïf d'evidence si présent
        // @ts-ignore
        if (Array.isArray(item.evidence) && item.evidence.length) {
            // @ts-ignore
            cur.evidence = [...(cur.evidence || []), ...item.evidence];
        }
    } else {
        list.push({
            ...(item as any),
            stats: { seenInRules: 1, totalConf: conf, avgConf: conf },
        });
    }
}

function resolveToAcceptedIdByLabel<T extends { id: ID; label_fr: string }>(
    accepted: T[],
    label: string
): T | null {
    const bySlug = slugify(label);
    const exact = accepted.find(a => slugify(a.label_fr) === bySlug);
    if (exact) return exact;
    let best: T | null = null, bestSim = 0;
    for (const a of accepted) {
        const sim = similarity(a.label_fr, label);
        if (sim > bestSim) { bestSim = sim; best = a; }
    }
    return bestSim >= THRESHOLDS.synonymSim ? best : null;
}

function promoteIfReady<T>(
    proposed: ProposedWithStats<T>[],
    accepted: { push: (x: any) => void },
    buildAccepted: (p: ProposedWithStats<T>) => any
): ProposedWithStats<T>[] {
    return proposed.filter(p => {
        const ok =
            p.stats.seenInRules >= THRESHOLDS.kOccurrences &&
            p.stats.avgConf >= THRESHOLDS.minAvgConfidence;
        if (ok) {
            accepted.push(buildAccepted(p));
            return false; // remove
        }
        return true;
    });
}

/* =========================
 * 3) Mergeur UL
 * ========================= */

function mergeProposals(ul: UL, props: ULProposals) {
    // 3.1 opérateurs
    for (const op of props.operators) {
        const near = resolveToAcceptedIdByLabel(ul.operators.accepted, op.label_fr);
        if (near) {
            // proposer un mapping synonyme -> opérateur existant
            upsertProposed(ul.mappings.proposed, {
                raw_phrase: op.label_fr,
                canonical: { kind: "operator", label_fr: near.label_fr },
                confidence: op.confidence ?? 0.6,
                evidence: op.evidence,
                introduced_in_ruleId: op.introduced_in_ruleId,
            }, (x) => `map:op:${slugify((x as MappingProposal).raw_phrase)}`);
            continue;
        }
        upsertProposed(ul.operators.proposed, op, (x) => slugify((x as OperatorProposal).label_fr));
    }

    // 3.2 dimensions (+ valeurs)
    for (const d of props.dimensions) {
        const near = resolveToAcceptedIdByLabel(ul.dimensions.accepted, d.label_fr);
        if (near) {
            // si la dimension existe déjà, proposer les values comme ajouts/mappings
            for (const val of d.values) {
                const valNear = near.values.find(v => similarity(v.label_fr, val.label_fr) >= THRESHOLDS.synonymSim);
                if (!valNear) {
                    upsertProposed(ul.dimensions.proposed, {
                        ...d,
                        values: [val], // isole la nouvelle value
                    }, (x) => `${slugify(d.label_fr)}::${slugify(val.label_fr)}`);
                }
            }
            continue;
        }
        upsertProposed(ul.dimensions.proposed, d, (x) => slugify((x as DimensionProposal).label_fr));
    }

    // 3.3 entités
    for (const e of props.entities) {
        const near = resolveToAcceptedIdByLabel(ul.entities.accepted, e.label_fr);
        if (near) {
            upsertProposed(ul.mappings.proposed, {
                raw_phrase: e.label_fr,
                canonical: { kind: "entity", label_fr: near.label_fr },
                confidence: e.confidence ?? 0.6,
                evidence: e.evidence,
                introduced_in_ruleId: e.introduced_in_ruleId,
            }, (x) => `map:ent:${slugify((x as MappingProposal).raw_phrase)}`);
            continue;
        }
        upsertProposed(ul.entities.proposed, e, (x) => slugify((x as EntityProposal).label_fr));
    }

    // 3.4 mappings (raw_phrase → canon par libellé)
    for (const m of props.mappings) {
        upsertProposed(ul.mappings.proposed, m, (x) => `map:${slugify((x as MappingProposal).raw_phrase)}`);
    }

    // 3.5 promotions (operators / dimensions / entities)
    ul.operators.proposed = promoteIfReady(
        ul.operators.proposed,
        ul.operators.accepted,
        (p) => ({
            id: slugify(p.label_fr),
            label_fr: p.label_fr,
            signature: p.signature,
            examples_fr: p.examples_fr,
            evidence: p.evidence || [],
            status: "accepted",
            introduced_in_ruleId: p.introduced_in_ruleId,
        })
    );

    ul.dimensions.proposed = promoteIfReady(
        ul.dimensions.proposed,
        ul.dimensions.accepted,
        (p) => ({
            id: slugify(p.label_fr),
            label_fr: p.label_fr,
            values: (p.values || []).map(v => ({ id: slugify(v.label_fr), label_fr: v.label_fr })),
            evidence: p.evidence || [],
            introduced_in_ruleId: p.introduced_in_ruleId,
        })
    );

    ul.entities.proposed = promoteIfReady(
        ul.entities.proposed,
        ul.entities.accepted,
        (p) => ({
            id: slugify(p.label_fr),
            label_fr: p.label_fr,
            evidence: p.evidence || [],
            introduced_in_ruleId: p.introduced_in_ruleId,
        })
    );

    // 3.6 mappings → accepted (si leur cible est résolue et seuils OK)
    ul.mappings.proposed = ul.mappings.proposed.filter(mp => {
        const { canonical } = mp;
        let resolved: Mapping["canonical"] | null = null;

        if (canonical.kind === "operator") {
            const target = resolveToAcceptedIdByLabel(ul.operators.accepted, canonical.label_fr);
            if (target) resolved = { kind: "operator", id: target.id };
        } else if (canonical.kind === "entity") {
            const target = resolveToAcceptedIdByLabel(ul.entities.accepted, canonical.label_fr);
            if (target) resolved = { kind: "entity", id: target.id };
        } else if (canonical.kind === "dimension") {
            const target = resolveToAcceptedIdByLabel(ul.dimensions.accepted, canonical.label_fr);
            if (target) resolved = { kind: "dimension", id: target.id };
        } else if (canonical.kind === "value") {
            // On résout à partir du libellé de dimension + value fournis dans le mapping
            const dim = resolveToAcceptedIdByLabel(ul.dimensions.accepted, canonical.label_fr);
            if (dim && canonical.value_label_fr) {
                const val = dim.values.find(v => similarity(v.label_fr, canonical.value_label_fr!) >= THRESHOLDS.synonymSim);
                if (val) resolved = { kind: "value", id: dim.id, valueId: val.id };
            }
        }

        const promotable =
            mp.stats.seenInRules >= THRESHOLDS.kOccurrences &&
            mp.stats.avgConf >= THRESHOLDS.minAvgConfidence &&
            !!resolved;

        if (promotable && resolved) {
            const accepted: Mapping = {
                raw_phrase: mp.raw_phrase,
                canonical: resolved,
                confidence: mp.stats.avgConf,
                evidence: (mp as any).evidence || [],
            };
            ul.mappings.accepted.push(accepted);
            return false; // remove from proposed
        }
        return true;
    });

    return ul;
}

/* =========================
 * 4) Chaîne LLM (LangChain)
 * ========================= */

// Sortie STRICTE JSON: { protoIR: ProtoIR, proposals: ULProposals }
const OutputSchema = z.object({
    protoIR: ProtoIRSchema,
    proposals: ULProposals,
});
type LLMOutput = z.infer<typeof OutputSchema>;

const parser = StructuredOutputParser.fromZodSchema(OutputSchema);
const formatInstructions = parser.getFormatInstructions();

const prompt = ChatPromptTemplate.fromMessages([
    ["system",
        `Tu es un extracteur juridique.

OBJECTIF:
- Convertir le texte d'une sous-règle de facturation médicale en:
  (1) Proto-IR (JSON) fidèle et structuré,
  (2) Propositions d'extension de langage (UL) ADDITIVES SEULEMENT.

CONTRAINTES:
- Retourne STRICTEMENT du JSON conforme aux instructions de format.
- N'insère AUCUN TEXTE HORS JSON.
- Ne modifie JAMAIS l'UL "accepted" fourni; propose uniquement des ajouts (proposed).
- Place les extraits cités dans "evidence".
- Signale toute ambiguïté dans "ambiguities".`
    ],
    ["human",
        `UL COURANT (résumé minimal pour contexte):
{ul_json}

SOUS-RÈGLE:
- ruleId: {rule_id}
- texte brut:
<<<
{text}
>>>

FORMAT DE SORTIE (obligatoire):
{format_instructions}

Rappels:
- operator_name: texte libre concis.
- arguments: codes, nombres, modificateurs, etc. tels qu'ils apparaissent.
- portee_raw / compteur_raw: expressions verbatim ("même séance", "par patient", "même côté"...).
- portee_hypotheses / compteur_hypotheses: tags candidats (ex. side:same, time_window:same_session) avec conf ∈ [0,1].
- Propositions UL: ajoute opérateurs/dimensions/entités/mappings SI ET SEULEMENT SI utiles.
- Chaque proposition inclut evidence + introduced_in_ruleId = {rule_id}.`
    ],
]);

const model = new ChatOpenAI({
    model: "gpt-5-chat-latest",
    openAIApiKey: process.env.OPENAI_API_KEY,
});

const chain = prompt.pipe(model).pipe(parser);

/* =========================
 * 5) Traitement incrémental
 * ========================= */

type Subrule = {
    ruleId: string;
    text: string; // texte consolidé (conditions + avis + en-tête, etc.)
};

async function processSubrule(sub: Subrule, ul: UL) {
    const res = await chain.invoke({
        ul_json: JSON.stringify({
            version: ul.version,
            operators: { accepted: ul.operators.accepted.map(o => ({ id: o.id, label_fr: o.label_fr, signature: o.signature })) },
            dimensions: { accepted: ul.dimensions.accepted.map(d => ({ id: d.id, label_fr: d.label_fr, values: d.values })) },
            entities:   { accepted: ul.entities.accepted.map(e => ({ id: e.id, label_fr: e.label_fr })) },
            mappings:   { accepted: ul.mappings.accepted }, // utile pour stabiliser les synonymes
        }, null, 2),
        rule_id: sub.ruleId,
        text: sub.text,
        format_instructions: formatInstructions,
    });

    // Validation host-side
    const { protoIR, proposals } = OutputSchema.parse(res);

    // Merge non destructif
    const ulNext = mergeProposals(structuredClone(ul), proposals);

    // File de revue minimale
    const reviewItems = [
        ...ulNext.operators.proposed.filter(p => p.stats.avgConf < 0.6).map(p => ({ kind: "operator", label: p.label_fr, stats: p.stats })),
        ...ulNext.dimensions.proposed.filter(p => p.stats.avgConf < 0.6).map(p => ({ kind: "dimension", label: p.label_fr, stats: p.stats })),
        ...ulNext.entities.proposed.filter(p => p.stats.avgConf < 0.6).map(p => ({ kind: "entity", label: p.label_fr, stats: p.stats })),
        ...ulNext.mappings.proposed.filter(p => p.stats.avgConf < 0.6).map(p => ({ kind: "mapping", label: p.raw_phrase, stats: p.stats })),
    ];

    return { protoIR, ulNext, reviewItems };
}

/* =========================
 * 6) Démo minimale
 * ========================= */

const SAMPLE_SUBRULES: Subrule[] = [
    {
        ruleId: "113488.1",
        text:
            `"Un seul des actes 05455, 06389 et 06390, faits du même côté, peut être facturé par patient, pour l'ensemble des chirurgiens généraux à la même séance."
Avis: "Pour chaque intervention, utiliser l'élément de contexte Intervention côté droit, Intervention côté gauche ou Intervention bilatérale."`
    },
    {
        ruleId: "113488.3",
        text:
            `"Un seul des actes 05455, 06389 et 06390, faits du même côté, peut être facturé par patient, pour l'ensemble des chirurgiens généraux à la même séance."
Avis: "Pour chaque intervention, utiliser l'élément de contexte Intervention côté droit ou Intervention côté gauche."`
    },
];


const inputFile = path.resolve(process.cwd(), "structured-content.json");
const outputFile = path.resolve(process.cwd(), "canoned-content.json");

async function main() {
    const maxStr = 50
    const offsetStr = 800

    // 1) Lecture + validation du JSON réel
    const raw = fs.readFileSync(inputFile, "utf-8");
    const parsed = JSON.parse(raw);
    const doc = DocumentSchema.parse(parsed);

    // 2) Aplatissement en sous-règles consommables par la chaîne
    const allSubs = flattenDocumentToSubrules(doc);

    // Options pratiques pour tester par lots
    const max = Math.max(0, maxStr);
    const offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10)) : 0;
    const batch = allSubs.slice(offset, offset + max);

    console.log(`Total subrules: ${allSubs.length}. Processing ${batch.length} (offset=${offset}).`);

    let ul: UL = structuredClone(initialUL);

    const data = [];

    for (const sub of batch) {
        console.log(`\n=== Processing subrule ${sub.ruleId} ===`);
        const { protoIR, ulNext, reviewItems } = await processSubrule(sub, ul);
        data.push({ subrule: sub, protoIR, ul: ulNext, reviewItems });
        ul = ulNext;
        console.log("ProtoIR:", JSON.stringify(protoIR, null, 2));
        let ulSnapshot = {
            operators: ul.operators.accepted.map(o => o.id),
            dimensions: ul.dimensions.accepted.map(d => ({ id: d.id, values: d.values.map(v => v.id) })),
            entities: ul.entities.accepted.map(e => e.id),
            mappings: ul.mappings.accepted.map(m => m.raw_phrase),
        };
        data.push({ subrule: sub, protoIR, ul: ulNext, reviewItems, ulSnapshot });
        console.log("UL snapshot (accepted):", JSON.stringify(ulSnapshot, null, 2));
        if (reviewItems.length) {
            console.log("Review queue (low-confidence):", reviewItems.slice(0, 10));
        }
    }

    fs.writeFileSync(outputFile, JSON.stringify(data, null, 2))

    console.log("\n=== FINAL UL ===");
    console.log(JSON.stringify(ul, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

