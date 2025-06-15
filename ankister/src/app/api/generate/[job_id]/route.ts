import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { NextRequest, NextResponse } from 'next/server';
import path from 'path'; // Import path module
import fs from 'fs';

export async function POST(request: NextRequest, { params }: { params: { job_id: string } }) {
const apiKey = process.env.GOOGLE_API_KEY;
const job_id = params.job_id;

const client = new MultiServerMCPClient({
  mcpServers: {
    "StudyTools": {
      command: "/Users/sascha/Documents/MSI/ankiBot/mcp_tools/.venv/bin/python",
      args: ["/Users/sascha/Documents/MSI/ankiBot/mcp_tools/server.py"],
      transport: "stdio",
    }
  }
})

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-pro-preview-06-05",
  apiKey: apiKey,
  verbose: true,
});
const agent = createReactAgent({
  llm,
  tools: await client.getTools(),
  responseFormat: z.object({
    message: z.string(),
    file_path: z.string(),
  }),
  prompt: "You are a helpful assistant that can create a qa file with questions that cover all the topics in the file. create the qa in german. after calling the finish_qa_file tool, you are done."
});

const markdownFilePath = path.join(process.cwd(), 'md-files', `${job_id}.md`);
console.log(`Agent will attempt to access markdown file at: ${markdownFilePath}`); // For debugging

const humanMessageContent = `can you give me a qa file with questions that cover all the topics in the file? the file with the info is at ${markdownFilePath} go through the file step by step and just choose a fitting title and an icon for the qa file. the job id is ${job_id}. `;

const response = await agent.invoke(
  { messages: [ { role: "user", content: humanMessageContent } ] }
, {
  debug: true,
}
);
console.log(response.structuredResponse);
await client.close();

const qaFilePath = response.structuredResponse.file_path;

// return the qa file
const qaFileContent = fs.readFileSync(qaFilePath, 'utf8');



return NextResponse.json({qaFileContent, fileName: job_id}, { status: 200 });
}
