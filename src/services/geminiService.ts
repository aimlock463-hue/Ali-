import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

export async function askGemini(prompt: string, imageBase64?: string) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Please add it to your environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: imageBase64 
      ? { parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }] }
      : { parts: [{ text: prompt }] },
    config: {
      systemInstruction: "You are a helpful AI Tutor. Explain concepts clearly and simply for students.",
    }
  });

  const response = await model;
  return response.text || "I couldn't generate an answer.";
}
