import { GoogleGenAI, Type } from '@google/genai';
import { fetchGithubRepo } from './github';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface AnalysisRawData {
  problemDescription: string;
  selectedFiles: string[];
  finalThoughts: string;
  finalSolution: string;
}

export async function analyzeProject(
  inputType: 'paste' | 'github' | 'upload',
  inputData: any,
  onProgress?: (msg: string) => void
): Promise<AnalysisRawData> {
  try {
    let filesRecord: Record<string, string> = {};
    let problemDescription = "";

    if (onProgress) onProgress("Gathering project files...");

    if (inputType === 'upload') {
      filesRecord = inputData.files;
      problemDescription = inputData.problem || "Please explain this project to me and find any potential issues.";
    } else if (inputType === 'github') {
      if (onProgress) onProgress("Fetching repository from GitHub...");
      filesRecord = await fetchGithubRepo(inputData.url);
      problemDescription = inputData.problem || "Please explain this project to me and find any potential issues.";
    } else if (inputType === 'paste') {
      filesRecord = { "pasted_code.txt": inputData.code };
      problemDescription = inputData.problem || "Please explain this code to me and find any potential issues.";
    }

    const filePaths = Object.keys(filesRecord);
    if (filePaths.length === 0) {
      throw new Error("No valid files found to analyze.");
    }

    // STEP 1: File Selection
    let selectedFiles: string[] = filePaths;
    if (filePaths.length > 5) {
      if (onProgress) onProgress("AI is deciding which files to read...");
      const fileSelectionPrompt = `
You are an expert developer debugging a project.
Here is the list of files in the project:
${filePaths.join('\n')}

The user reported the following problem/request:
"${problemDescription}"

Which files do you need to read to understand and solve this problem?
Return a JSON array of file paths. Choose a maximum of 10 most relevant files.
`;
      try {
        const selectionRes = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: fileSelectionPrompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        });
        selectedFiles = JSON.parse(selectionRes.text || "[]");
        // filter to ensure they actually exist
        selectedFiles = selectedFiles.filter(f => filesRecord[f]);
        if (selectedFiles.length === 0) selectedFiles = filePaths.slice(0, 10);
      } catch (e) {
        console.warn("File selection failed, defaulting to first 10 files.");
        selectedFiles = filePaths.slice(0, 10);
      }
    }

    // Prepare the content of selected files
    let selectedFilesContent = "";
    for (const path of selectedFiles) {
      selectedFilesContent += `\n--- File: ${path} ---\n\`\`\`\n${filesRecord[path]}\n\`\`\`\n`;
    }

    // STEP 2: Multi-Agent Analysis
    if (onProgress) onProgress("Agent 1 is analyzing the problem...");
    
    const agentPromptTemplate = (previousThoughts: string = "") => `
You are an elite software debugger, system evaluator, and software detective.
The user has provided the following files from their project:
${selectedFilesContent}

The user's problem/request is:
"${problemDescription}"

${previousThoughts ? `Another agent previously looked at this and thought:\n${previousThoughts}\n\nYou must look at this from a COMPLETELY DIFFERENT ANGLE. Do not repeat the same mistakes. Look for subtle state mutations, race conditions, temporal logic bugs, or emergent interaction flaws they missed.` : ""}

CRITICAL INSTRUCTIONS:
1. DO NOT REWRITE THE ENTIRE SYSTEM. You must prefer the absolute minimal targeted fix.
2. Act as a deterministic debugging engine. You MUST explicitly perform:
   - Variable Lifecycle Tracing: Map out exactly where key variables are initialized, read, and modified (e.g., "duration -> modified in pause()").
   - Invariant Reasoning: Define the logical invariants of the system (e.g., "duration must always equal the total session length") and explicitly state which invariant is violated and how.
3. Be aware of the 5 hardest bug classes: Non-Local State Mutation, Temporal Logic Bugs, Emergent Interaction Bugs, Environment-Dependent Bugs, and Hidden Feedback Loops (or Heisenbugs).
4. Confidence Calibration: Real-world debugging is uncertain. NEVER output 100% confidence unless it is a trivial syntax error. For logical, state, or timing bugs, your confidence should reflect realistic uncertainty (e.g., 75-90%).
5. Think about the BIG picture. Do not hallucinate. If you suspect a file is missing that is crucial for the bug fix, explicitly state it in 'missing_context_or_files'.
6. Consider Alternative Hypotheses before settling on your final root cause.

Provide your analysis strictly matching the requested JSON schema.
`;

    const agentSchema = {
      type: Type.OBJECT,
      properties: {
        symptom: { type: Type.STRING },
        reproduction_steps: { type: Type.STRING },
        variable_lifecycle_trace: { 
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              variable_name: { type: Type.STRING },
              where_initialized: { type: Type.STRING },
              where_modified: { type: Type.STRING },
              description: { type: Type.STRING }
            }
          }
        },
        execution_timeline: { type: Type.STRING },
        system_invariants: { 
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              rule: { type: Type.STRING },
              is_violated: { type: Type.BOOLEAN },
              violation_details: { type: Type.STRING }
            }
          }
        },
        root_cause: { type: Type.STRING },
        exact_code_location: { 
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        minimal_fix: { type: Type.STRING },
        why_fix_works: { type: Type.STRING },
        bug_type_classification: { type: Type.STRING },
        alternative_hypotheses: { type: Type.STRING },
        missing_context_or_files: { type: Type.STRING },
        confidence_score: { type: Type.NUMBER }
      },
      required: [
        "symptom", "reproduction_steps", "variable_lifecycle_trace", 
        "execution_timeline", "system_invariants", "root_cause", 
        "exact_code_location", "minimal_fix", "why_fix_works", 
        "bug_type_classification", "alternative_hypotheses", 
        "missing_context_or_files", "confidence_score"
      ]
    };

    let agent1Res;
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: agentPromptTemplate(),
        config: {
          responseMimeType: 'application/json',
          responseSchema: agentSchema,
          temperature: 0.2
        }
      });
      agent1Res = JSON.parse(res.text || "{}");
    } catch (e) {
      throw new Error("Agent 1 failed to analyze the code.");
    }

    const formatAgentOutput = (res: any) => {
      const varTrace = res.variable_lifecycle_trace?.map((v: any) => 
        `- **${v.variable_name}**: Init in \`${v.where_initialized}\`, Modified in \`${v.where_modified}\`. (${v.description})`
      ).join('\n') || 'None';

      const invariants = res.system_invariants?.map((i: any) => 
        `- **Invariant**: ${i.rule}\n  - Violated? ${i.is_violated ? 'YES ❌' : 'NO ✅'}\n  - Details: ${i.violation_details}`
      ).join('\n') || 'None';

      return {
        thoughts: `Symptom: ${res.symptom}\nReproduction: ${res.reproduction_steps}\n\nVariable Lifecycle Trace:\n${varTrace}\n\nExecution Timeline:\n${res.execution_timeline}\n\nSystem Invariants:\n${invariants}\n\nRoot Cause:\n${res.root_cause}\n\nExact Code Location:\n${res.exact_code_location?.join('\n')}\n\nAlternative Hypotheses:\n${res.alternative_hypotheses}\n\nMissing Context/Files:\n${res.missing_context_or_files}`,
        solution: `Minimal Fix:\n${res.minimal_fix}\n\nWhy it works:\n${res.why_fix_works}\n\nBug Type: ${res.bug_type_classification}\nConfidence: ${res.confidence_score}%`
      };
    };

    let finalSolution = formatAgentOutput(agent1Res).solution;
    let finalThoughts = formatAgentOutput(agent1Res).thoughts;

    if (agent1Res.confidence_score < 90) {
      if (onProgress) onProgress(`Agent 1 confidence is ${agent1Res.confidence_score}%. Invoking Agent 2 for a second opinion...`);
      
      let agent2Res;
      try {
        const res = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: agentPromptTemplate(`Agent 1 Thought Process:\n${finalThoughts}\n\nAgent 1 Solution:\n${finalSolution}`),
          config: {
            responseMimeType: 'application/json',
            responseSchema: agentSchema,
            temperature: 0.7 // higher temperature for a different angle
          }
        });
        agent2Res = JSON.parse(res.text || "{}");
        
        // Combine or pick the best
        if (agent2Res.confidence_score > agent1Res.confidence_score) {
          finalSolution = formatAgentOutput(agent2Res).solution;
          finalThoughts = `Agent 1 thought:\n${finalThoughts}\n\nBut Agent 2 realized:\n${formatAgentOutput(agent2Res).thoughts}`;
        } else {
          finalThoughts = `Agent 1 thought:\n${finalThoughts}\n\nAgent 2 added:\n${formatAgentOutput(agent2Res).thoughts}`;
          finalSolution = `Primary Solution:\n${finalSolution}\n\nAlternative Solution:\n${formatAgentOutput(agent2Res).solution}`;
        }
      } catch (e) {
        // fallback to agent 1
        console.warn("Agent 2 failed, using Agent 1's result.");
      }
    } else {
      if (onProgress) onProgress(`Agent 1 is highly confident (${agent1Res.confidence_score}%).`);
    }

    if (onProgress) onProgress("Analysis complete. Ready for your questions.");

    return {
      problemDescription,
      selectedFiles,
      finalThoughts,
      finalSolution
    };
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    throw new Error(error.message || "Failed to analyze the project. Please try again.");
  }
}

export async function generateReport(
  type: 'plain' | 'technical' | 'prompt' | 'code' | 'all',
  rawData: AnalysisRawData,
  experience: 'vibe_coder' | 'some_knowledge' | 'experienced',
  language: 'hinglish' | 'hindi' | 'english'
): Promise<string> {
  try {
    const personaMap = {
      vibe_coder: "The user is a 'Complete Vibe Coder' who has no idea how code works. They just use AI tools (like Cursor, Bolt) to generate apps. Avoid technical jargon completely unless you explain it immediately in simple terms.",
      some_knowledge: "The user has 'Some Knowledge'. They can read basic HTML/JS but get stuck easily. You can use some technical terms but always clarify the 'why'.",
      experienced: "The user is 'Experienced' but rusty. They understand programming concepts. Give them a clear, concise breakdown. Focus on the 'gotchas' of modern frameworks or specific errors."
    };

    const languageMap = {
      hinglish: "Respond in natural, conversational Hinglish (a mix of Hindi and English written in the Latin alphabet). Use common Hinglish phrases.",
      hindi: "Respond in pure Hindi (written in Devanagari script). Ensure the tone is helpful, respectful, and easy to understand.",
      english: "Respond in clear, accessible English. The tone should be friendly, encouraging, and mentoring."
    };

    let typeInstruction = "";
    switch (type) {
      case 'plain':
        typeInstruction = "Explain what went wrong and how to fix it in plain, non-technical language. Use simple analogies (like cooking, building a house). Do NOT show any code blocks. Focus on the 'why' and 'how' conceptually.";
        break;
      case 'technical':
        typeInstruction = "Explain the root cause, the architecture, and the solution using standard software engineering terminology. Be concise and precise. You can include small code snippets if necessary to explain the architecture.";
        break;
      case 'prompt':
        typeInstruction = "Provide ONLY a highly effective, detailed prompt that the user can copy and paste into an AI assistant (like Cursor, Bolt, or ChatGPT) to fix this issue. Do not include pleasantries, just the prompt text. Use markdown code blocks for the prompt.";
        break;
      case 'code':
        typeInstruction = "Provide ONLY the exact code snippets needed to fix the issue. Include the filename above each snippet. Do not include long explanations, just the code.";
        break;
      case 'all':
        typeInstruction = `Provide a comprehensive, highly structured debugging report including:
1. **Symptom & Reproduction**: What is happening and how to trigger it.
2. **Technical Root Cause**: Explain the exact mechanism failing (referencing the variable trace and timeline).
3. **Simple Metaphor**: Explain the root cause using a simple real-world analogy (e.g., petrol tank, cooking). This MUST come AFTER the technical explanation.
4. **Code Location & Minimal Fix**: Show the exact lines responsible and the smallest possible code change to fix it.
5. **Why This Works**: Explain the logic behind the fix.
6. **Bug Classification & Confidence**: e.g., "State Mutation Bug (95% Confidence)".
7. **Core Concept to Learn**: What programming concept should the user learn to avoid this in the future?
8. **Next Steps (AI Prompt)**: Give the user the exact prompt they should copy-paste back into their AI to apply this fix.
9. **Missing Files**: If the agents noted any missing files, ask the user to provide them.`;
        break;
    }

    const systemInstruction = `
You are 'Unravel', an extremely smart, empathetic 'Trust Engine' and AI mentor.
User Profile:
- Experience Level: ${personaMap[experience]}
- Language Preference: ${languageMap[language]}

Your Task:
${typeInstruction}

Tone:
- Be encouraging. Don't make them feel stupid.
- Be highly structured (use bolding, bullet points, emojis).
`;

    const finalPrompt = `
Here is the project context and the expert agents' findings:

User Problem: ${rawData.problemDescription}

Files analyzed:
${rawData.selectedFiles.join(', ')}

Expert Agents' Thoughts:
${rawData.finalThoughts}

Expert Agents' Proposed Solution:
${rawData.finalSolution}

Based on this, generate the requested output.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: finalPrompt,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    if (!response.text) {
      throw new Error("Received an empty response from the AI.");
    }

    return response.text;
  } catch (error: any) {
    console.error("Report Generation Error:", error);
    throw new Error(error.message || "Failed to generate the report. Please try again.");
  }
}
