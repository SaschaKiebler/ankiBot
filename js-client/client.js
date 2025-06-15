import dotenv from 'dotenv';
dotenv.config();

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const apiKey = process.env.GOOGLE_API_KEY;

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
  prompt: "You are a helpful assistant that can create a qa file with questions that cover all the topics in the file."
});

const response = await agent.invoke(
  { messages: [ { role: "user", content: "what's up can you give me a qa file with questions that cover all the topics in the file? the file with the info is at /Users/sascha/Documents/MSI/ankiBot/md-files/AlgoTech01.md go through the file step by step and just choose a fitting title and an icon for the qa file" } ] }
, {
  debug: true,
  verbose: true,
}
);
console.log(response);
await client.close();