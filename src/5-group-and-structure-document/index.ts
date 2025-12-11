import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";

// Load environment variables
dotenv.config();

interface CodeActe {
    code: string;
    description: string;
    amount_facility?: number;
    amount_r2?: number;
    amount_cabinet?: number;
}

type Document = { name: string; rules: Rule[] }[]

interface Rule {
    id: string;
    title: string;
    description?: string;
    subrules?: SubRule[];
    codes?: CodeActe[];
}

interface SubRule {
    id: string;
    text: string;
    conditions?: string[];
    avis?: string[];
    codes?: CodeActe[];
}

interface Section {
    "id": string,
    "parentId": string,
    name: string;
    content: (string | CodeActe)[];
}

// Chemin vers ton JSON d'entrée
const inputFile = path.resolve(process.cwd(), "modified-content.json");
const outputFile = path.resolve(process.cwd(), "structured-content.json");

// Check if input file exists
if (!fs.existsSync(inputFile)) {
    console.error(`❌ Input file not found: ${inputFile}`);
    console.error("Please ensure modified-content.json exists in the project root");
    process.exit(1);
}

const rawData = fs.readFileSync(inputFile, "utf-8");
const sections: Section[] = JSON.parse(rawData);


// Prompt pour structurer une section
const promptTemplate = `
Tu es un expert en tarification médicale RAMQ et en extraction d’informations structurées. 
Ta tâche : transformer une section brute (mélange de texte et d’objets code) en un ARRAY JSON de "rules" **strictement valide** et **normalisée pour facturation**.

## Entrée
Voici la section au format JSON:
{sectionJSON}

## Objectif
Produis un ARRAY JSON (et rien d’autre que ce JSON) contenant des "rules" regroupées de façon logique pour la facturation (une règle = un thème/cohérence métier). 
N’invente rien. Si une info manque, omets le champ. 
**Tu dois agréger :**
- Conditions de facturation et périmètres (ex.: hospitalisé/externe/cabinet, “par jour, par patient”, “1er jour”, “2e au 10e jour”, “maximum 1 fois/mois”, etc.)
- AVIS / NOTE / renvois à une règle RAMQ ou annexe (conserve le texte exact)
- Codes d’actes (code, description, montants)
- Regroupements hiérarchiques (règle → sous-règles) quand le texte l’implique (titres, intertitres, sections “Cabinet privé :”, “Externe”, “AVEC PRISE EN CHARGE…”)

## Filtrage (important)
Ne retiens **que** l’information pertinente à une application de **facturation médicale** :
- GARDER : codes, descriptions d’actes, montants (et leur contexte: facility/cabinet/r2), conditions d’admissibilité/quantification (“par jour”, “premières 24h”, intervalles de jours, patient hospitalisé/externe, etc.), limites et fréquences, exigences de traçabilité (heure d’entrée/sortie), AVIS/NOTE applicables à la facturation, références à d’autres règles/annexes (en les listant).
- ÉCARTER : éléments narratifs non prescriptifs, redondances sans impact de facturation. Si un texte apporte juste un contexte clinique sans impact de facturation, ne le garder que s’il restreint l’admissibilité (ex.: “intubé et sous ventilation mécanique”).

## Normalisation attendue
- **Montants** : place-les dans \`amount_facility\`, \`amount_cabinet\`, \`amount_r2\` quand explicitement présents. Ne convertis pas la devise, ne calcule rien. Ne déduis pas un montant absent.
- **Phrases typiques** :
  - Lignes “AVIS : …” ⇒ mets le texte exact dans \`avis\`.
  - Lignes “NOTE : …” ⇒ mets le texte exact dans \`notes\`.
  - En-têtes/sections (“Cabinet privé :”, “Externe”, “AVEC PRISE EN CHARGE …”) ⇒ si elles structurent des conditions, crée une \`subrule\` dédiée avec \`text\` décrivant le périmètre (ex.: \`text: "Cabinet privé"\`), et insère-y les codes/conditions qui suivent jusqu’au prochain changement de périmètre.
  - Lignes avec montant SANS code (ex.: “---- Supplément de consultation 78.15”) ⇒ conserve-les en \`subrules\` (dans \`text\`) avec le montant **dans le texte**. **Ne crée pas de code artificiel.**
  - Intervalles/quantificateurs (“1er jour”, “2e au 10e jour”, “par jour”, “premières 24 heures”) ⇒ mets-les dans \`conditions\`.
  - Références (“Voir la Règle d'application no 21”, “Voir l’Annexe 29”) ⇒ ajoute les textes exacts dans \`references\` (array de strings).

## Schéma de sortie (types cibles)
[
  {{
    "id": "string",                      // Identifiant local libre (ex.: "6", "6.1"); ne pas inventer de sémantique
    "title": "string",                   // Titre concis de la règle (déduit d’un en-tête ou d’un thème clair)
    "description": "string",             // Résumé utile à la facturation (optionnel)
    "references": ["string"],            // Renvois à règles/annexes (texte exact)
    "avis": ["string"],                  // Liste des AVIS exacts
    "notes": ["string"],                 // Liste des NOTE exactes
    "subrules": [
      {{
        "id": "string",
        "text": "string",                // Texte de sous-règle (intitulé, périmètre, précision)
        "conditions": ["string"],        // Contraintes, unités, intervalles (“par jour”, “1er jour”...)
        "avis": ["string"],
        "notes": ["string"],
        "references": ["string"],
        "codes": [
          {{
            "code": "string",
            "description": "string",
            "amount_facility": number,
            "amount_r2": number,
            "amount_cabinet": number
          }}
        ]
      }}
    ],
    "codes": [
      {{
        "code": "string",
        "description": "string",
        "amount_facility": number,
        "amount_r2": number,
        "amount_cabinet": number
      }}
    ]
  }}
]

## Règles de grouping (très important)
- Si une zone (ex.: “Externe”) contient plusieurs éléments (avis, conditions, codes), crée **une seule** \`subrule\` pour ce périmètre et imbrique dedans ce qui suit, jusqu’au prochain changement de périmètre.
- Si une condition s’applique à plusieurs codes (ex.: “par jour, par patient”), la placer **une seule fois** au niveau de la \`subrule\` correspondante.
- Les soins spécifiques (ex.: “Soins neurochirurgicaux pour traumatisme…”) deviennent des \`subrules\` distinctes si leurs conditions/éligibilités diffèrent.

## Exemples brefs de mapping (indicatifs)
- “AVIS : … Voir la Règle …” → \`avis\` + \`references\`.
- “par jour, par patient” → \`conditions: ["par jour, par patient"]\`
- “09098 chaque jour subséquent … Annexe 29” (sans objet code) → reste en \`subrules[].text\` et \`references\`, pas de \`codes\`.

## Sortie attendue
- Réponds **strictement** par un **ARRAY JSON valide** (UTF-8), **sans** texte additionnel, **sans** commentaires, **sans** trailing commas.
- N’inclus pas de champs vides avec \`null\` ; omets-les simplement.
`;


const llm = new ChatOpenAI({
    model: "gpt-5-chat-latest",
    openAIApiKey: process.env.OPENAI_API_KEY,
});

async function processSection(section: Section): Promise<Rule[]> {
    try {
        // Format the section data for the prompt
        const sectionJSON = JSON.stringify(section, null, 2);
        
        // Create the prompt with the section data
        const prompt = PromptTemplate.fromTemplate(promptTemplate);
        
        // Format the prompt with the section data
        const formattedPrompt = await prompt.format({
            sectionJSON: sectionJSON
        });
        
        // Get the response from ChatGPT
        const response = await llm.invoke(formattedPrompt);
        
        // Parse the response to extract the rules
        const content = response.content as string;
        
        // Try to extract JSON from the response
        let rules: Rule[] = [];
        
        // Look for JSON content in the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                rules = JSON.parse(jsonMatch[0]);
            } catch (parseError) {
                console.error(`Error parsing JSON response for section ${section.name}:`, parseError);
                console.log("Raw response:", content);
                // Return empty rules if parsing fails
                return [];
            }
        } else {
            console.warn(`No valid JSON array found in response for section ${section.name}`);
            console.log("Raw response:", content);
            return [];
        }
        
        console.log(`Generated ${rules.length} rules for section: ${section.name}`);
        return rules;
        
    } catch (error) {
        console.error(`Error processing section ${section.name}:`, error);
        return [];
    }
}

async function main() {
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
        console.error("❌ OPENAI_API_KEY not configured in .env file");
        console.error("Please add your OpenAI API key to the .env file");
        process.exit(1);
    }

    console.log("🚀 Starting document structuring process...");
    console.log(`📁 Processing ${sections.length} sections from: ${inputFile}`);
    
    const structuredSections: { name: string; rules: Rule[] }[] = [];

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        console.log(`\n📋 Processing section ${i + 1}/${sections.length}: ${section.name}`);
        
        try {
            const rules = await processSection(section);
            structuredSections.push({ name: section.name, rules });
            console.log(`✅ Section processed successfully - Generated ${rules.length} rules`);
        } catch (error) {
            console.error(`❌ Error processing section "${section.name}":`, error);
            // Continue with next section instead of failing completely
            structuredSections.push({ name: section.name, rules: [] });
        }
        
        // Add a small delay to avoid rate limiting
        if (i < sections.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Save the result
    fs.writeFileSync(outputFile, JSON.stringify(structuredSections, null, 2));

    console.log(`\n🎉 Structuring completed successfully!`);
    console.log(`📊 Total sections processed: ${structuredSections.length}`);
    console.log(`📄 Output saved to: ${outputFile}`);
    
    // Show summary
    const totalRules = structuredSections.reduce((sum, section) => sum + section.rules.length, 0);
    console.log(`📋 Total rules generated: ${totalRules}`);
}

main().catch(console.error);
