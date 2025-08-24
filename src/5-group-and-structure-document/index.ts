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
