import fs from "fs";
import path from "path";

interface CodeActe {
    code: string;
    description: string;
    amount_facility?: number;
    amount_r2?: number;
    amount_cabinet?: number;
}

interface SubRule {
    id: string;
    text: string;
    conditions?: string[];
    avis?: string[];
    codes?: CodeActe[];
}

interface Rule {
    id: string;
    title: string;
    description?: string;
    subrules?: SubRule[];
    codes?: CodeActe[];
}

interface Section {
    name: string;
    content: (string | CodeActe)[];
}

// Chemin vers ton JSON d’entrée
const inputFile = path.resolve(__dirname, "ramq.json");
const rawData = fs.readFileSync(inputFile, "utf-8");
const sections: Section[] = JSON.parse(rawData);


// Prompt pour structurer une section
const promptTemplate = `
Tu es un expert en analyse de documents de tarification médicale.
Tu reçois une section d'un manuel RAMQ sous forme JSON, par exemple :

{sectionJSON}

Transforme le contenu en un array de "rules" structurées de la manière suivante :
[
  {{
    id: "6",
    title: "Titre de la règle",
    description: "Description générale",
    subrules: [
      {{
        id: "6.1",
        text: "Texte de la sous-règle",
        conditions: ["liste des conditions"],
        avis: ["liste des AVIS"],
        codes: [
          {{
            code: "06058",
            description: "Description de l'acte",
            amount_facility: 211.1,
            amount_r2: 4
          }}
        ]
      }}
    ],
    codes: [
      {{
        code: "06058",
        description: "Description de l'acte",
        amount_facility: 211.1
      }}
    ]
  }}
]

Ne crée pas de règles ou sous-règles qui n'existent pas. Si certaines informations n’existent pas, laisse le champ vide ou absent.
Répond strictement en JSON valide.
`;

async function processSection(section: Section): Promise<Rule[]> {
    // TODO
}

async function main() {
    const structuredSections: { name: string; rules: Rule[] }[] = [];

    for (const section of sections) {
        console.log(`Traitement de la section: ${section.name}`);
        const rules = await processSection(section);
        structuredSections.push({ name: section.name, rules });
    }

    // Sauvegarde le résultat
    fs.writeFileSync(
        path.resolve(__dirname, "ramq_structured.json"),
        JSON.stringify(structuredSections, null, 2)
    );

    console.log("Structuration terminée ✅");
}

main().catch(console.error);
