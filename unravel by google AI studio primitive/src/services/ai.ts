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
You are an expert software engineer and debugger.
The user has provided the following files from their project:
${selectedFilesContent}

The user's problem/request is:
"${problemDescription}"

${previousThoughts ? `Another agent previously looked at this and thought:\n${previousThoughts}\n\nYou must look at this from a COMPLETELY DIFFERENT ANGLE. Do not repeat the same mistakes. If their solution seems wrong or incomplete, provide a better one.` : ""}

Analyze the problem and provide:
1. Your thought process (what you looked at, how you diagnosed it).
2. Your proposed solution.
3. Your confidence score in this solution (0 to 100).
`;

    const agentSchema = {
      type: Type.OBJECT,
      properties: {
        thought_process: { type: Type.STRING },
        solution: { type: Type.STRING },
        confidence_score: { type: Type.NUMBER }
      },
      required: ["thought_process", "solution", "confidence_score"]
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

    let finalSolution = agent1Res.solution;
    let finalThoughts = agent1Res.thought_process;

    if (agent1Res.confidence_score < 90) {
      if (onProgress) onProgress(`Agent 1 confidence is ${agent1Res.confidence_score}%. Invoking Agent 2 for a second opinion...`);
      
      let agent2Res;
      try {
        const res = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: agentPromptTemplate(`Agent 1 Thought Process:\n${agent1Res.thought_process}\n\nAgent 1 Solution:\n${agent1Res.solution}`),
          config: {
            responseMimeType: 'application/json',
            responseSchema: agentSchema,
            temperature: 0.7 // higher temperature for a different angle
          }
        });
        agent2Res = JSON.parse(res.text || "{}");
        
        // Combine or pick the best
        if (agent2Res.confidence_score > agent1Res.confidence_score) {
          finalSolution = agent2Res.solution;
          finalThoughts = `Agent 1 thought: ${agent1Res.thought_process}\nBut Agent 2 realized: ${agent2Res.thought_process}`;
        } else {
          finalThoughts = `Agent 1 thought: ${agent1Res.thought_process}\nAgent 2 added: ${agent2Res.thought_process}`;
          finalSolution = `Primary Solution:\n${agent1Res.solution}\n\nAlternative Solution:\n${agent2Res.solution}`;
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
        typeInstruction = `Provide a comprehensive report including:
1. **The Big Picture**: Explain what the project is trying to do.
2. **File Breakdown**: Briefly explain the purpose of the key files.
3. **The Bugs & Fixes**: Identify why it broke and provide the exact fix.
4. **Next Steps**: Give the user the exact prompt they should copy-paste back into their AI to fix it.`;
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
