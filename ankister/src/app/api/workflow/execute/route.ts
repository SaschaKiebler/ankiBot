import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { NextRequest, NextResponse } from 'next/server';
import axios from "axios";
import { EventEmitter } from 'events';

// Increase max listeners to prevent memory leak warnings
EventEmitter.defaultMaxListeners = 20;

export const LANGSMITH_API_KEY = process.env.LANGSMITH_API_KEY;
export const LANGSMITH_PROJECT_NAME = process.env.LANGSMITH_PROJECT_NAME;
export const LANGSMITH_API_URL = process.env.LANGSMITH_API_URL;
export const LANGCHAIN_CALLBACKS_BACKGROUND=true;

export async function POST(request: NextRequest) {
// get the api keys
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
    return NextResponse.json({ error: 'Google API key not found.' }, { status: 500 });
}

// Local PDF parser doesn't need an API key

// get the content as markdown from the request pdf
const formData = await request.formData();
const file = formData.get('file') as File | null;
if (!file || file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'No file provided or invalid file type.' }, { status: 400 });
}

// upload the pdf to our local PDF parser
const form = new FormData();
form.append('file', file, file.name);

// Create the parsing job
const createJobResponse = await axios.post(
    'http://localhost:8001/api/v1/parsing/upload',
    form,
    {
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'multipart/form-data'
        }
    }
);

const job_id = createJobResponse.data.id;

// Check the status of the parsing job and wait till it returns SUCCESS
let jobStatus = 'PENDING';
let jobResponse;

while (jobStatus !== 'SUCCESS' && jobStatus !== 'FAILED') {
    try {
        jobResponse = await axios.get(
            `http://localhost:8001/api/v1/parsing/job/${job_id}`
        );
        jobStatus = jobResponse.data.status;
        console.log(`Job status: ${jobStatus}`);
        
        if (jobStatus === 'FAILED') {
            throw new Error('PDF processing failed');
        }
        
        if (jobStatus !== 'SUCCESS') {
            await new Promise(resolve => setTimeout(resolve, 4000));
        }
    } catch (error) {
        console.error('Error checking job status:', error);
        await new Promise(resolve => setTimeout(resolve, 4000));
    }
}

// Get the markdown result
const resultResponse = await axios.get(
    `http://localhost:8001/api/v1/parsing/job/${job_id}/result/markdown`,
    {
        responseType: 'text'
    }
);

const markdown = resultResponse.data;

// split the markdown into pages based on the '---' separator
const pages = markdown.split('\n---\n');

console.log("------------------------------pages length: ", pages.length + "-----------------------------");

// create a list with the first 50 chars of each page to create a readable doc for the agent that has to sort the pages into chapters
const pagesList = pages.map((page: string) => page.slice(0, 80)+ '...\n\n');

// create a markdown string from the list
const pagesListMarkdown = pagesList.join('\n\n');

let chapters: { [key: string]: string } = {};

const createChapterTool = tool(
    async (input: { start_page: number; end_page: number; chapter_name: string }) => {
        for (let i = input.start_page; i <= input.end_page; i++) {
            chapters[input.chapter_name] += pages[i];
        }
        return `created chapter from pages ${input.start_page} to ${input.end_page}`;
    },
    {
      name: "create_chapter",
      schema: z.object({
        start_page: z.number().describe("The start page of the chapter"),
        end_page: z.number().describe("The end page of the chapter"),
        chapter_name: z.string().describe("The name of the chapter"),
      }),
      description: "Create a chapter from the pages between start_page and end_page.",
    }
  );

const getChapterTool = tool(
    async (input: { chapter_name: string }) => {
        return chapters[input.chapter_name];
    },
    {
      name: "get_chapter",
      schema: z.object({
        chapter_name: z.string().describe("The exact name of the chapter"),
      }),
      description: "Get the chapter with the exact name.",
    }
  );

let qaList: {question: string, answer: string}[] = [];

const saveQATool = tool(
    async (input: { qa_list: {question: string, answer: string}[] }) => {
        qaList.push(...input.qa_list);
        return "qa saved";
    },
    {
      name: "save_qa",
      schema: z.object({
        qa_list: z.array(z.object({
          question: z.string().describe("The question"),
          answer: z.string().describe("The answer"),
        })).describe("The qa list"),
      }),
      description: "Save the qa_pairs.",
    }
  );

// declare llm
const llm_advanced = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro-preview-06-05",
    apiKey: apiKey,
    verbose: true,
  });

const llm_light = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: apiKey,
    verbose: true,
  });

// give the markdown to the structureIntoChapters Agent
const structureIntoChaptersAgent = createReactAgent({
    llm: llm_advanced,
    tools: [createChapterTool],
    responseFormat: z.object({
      message: z.string(),
    }),
    prompt: "Split the preview file into chapters and use the tool for each chapter."
  });

  const structureIntoChaptersAgentResponse = await structureIntoChaptersAgent.invoke({
    messages: [{ role: "user", content: pagesListMarkdown }],
  });

  console.log(structureIntoChaptersAgentResponse.structuredResponse);

  const chapterKeys = Object.keys(chapters);
  console.log(chapterKeys);
        
const qaAgent = createReactAgent({
  llm: llm_advanced,
  tools: [getChapterTool, saveQATool],
  prompt: "the user will provide a list of chapters and you have to create a qa file for each chapter that is useful to learn so a.e. dont create a qafile for the Inhaltsverzeichnis. use the get_chapter tool to get the chapter content and the save_qa tool to save the qa file. make sure to get each chapter step by step and create a qa file for each chapter with qa pairs that cover all the topics in the chapter. allways write the qa pairs in german. get back to the user only when you finished for all chapters."
});


const qaAgentResponse = await qaAgent.invoke({
  messages: [{ role: "user", content: `the chapters are: ${chapterKeys.join(',\n')}` }],
}, {
  recursionLimit: 100,

} );

console.log(qaAgentResponse.structuredResponse);



return NextResponse.json({qaList}, { status: 200 });
}
