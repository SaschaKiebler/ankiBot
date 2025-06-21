import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { NextRequest, NextResponse } from 'next/server';
import axios from "axios";
import { EventEmitter } from 'events';
import dotenv from "dotenv";
dotenv.config();

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

// New State Definition
type Chapter = {
  name: string;
  content: string;
};

type QAPair = {
  question: string;
  answer: string;
};

const channels = {
  chapters: {
    value: (_: Chapter[], y: Chapter[]) => y,
    default: () => [],
  },
  qa_pairs: {
    value: (x: QAPair[], y: QAPair[]) => x.concat(y),
    default: () => [],
  },
  markdown_pages: {
    value: (_: string[], y: string[]) => y,
    default: () => [],
  }
};

type GraphState = {
  chapters: Chapter[];
  qa_pairs: QAPair[];
  markdown_pages: string[];
};

// LLM with structured output for chapters
const chapterSchema = z.object({
  chapters: z.array(
    z.object({
      chapter_name: z.string().describe("The name of the chapter"),
      start_page: z.number().describe("The start page number of the chapter, 1-indexed"),
      end_page: z.number().describe("The end page number of the chapter, 1-indexed"),
    })
  ).describe("An array of chapters found in the document"),
});

const llm_advanced = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-pro-preview-06-05",
  apiKey: apiKey,
  verbose: true,
}).withStructuredOutput(chapterSchema);

// LLM for QA generation
const qaSchema = z.object({
  qa_pairs: z.array(
    z.object({
      question: z.string().describe("The generated question"),
      answer: z.string().describe("The corresponding answer"),
    })
  ).describe("An array of question-answer pairs"),
});

const qa_llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro-preview-06-05",
    apiKey: apiKey,
    verbose: true,
}).withStructuredOutput(qaSchema);


// Node to create chapters
const createChaptersNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  console.log("--- Creating Chapters ---");
  
  const pagesList = state.markdown_pages.map((page: string, index: number) => `Page ${index + 1}: ${page.slice(0, 150)}...\n\n`);
  const pagesListMarkdown = pagesList.join('\n');

  const result = await llm_advanced.invoke([
    new SystemMessage("You are an expert at analyzing documents and identifying the main chapters. Extract the chapters with their start and end pages based on the provided table of contents and page snippets. The page numbers are 1-indexed. dont create chapters for the unimportant pages like tables of contents, indexes, etc."),
    new HumanMessage(pagesListMarkdown),
  ]);

  const chapters = result.chapters.map(chapter => {
    let content = "";
    // pages array is 0-indexed, so we subtract 1 from the 1-indexed start_page
    for (let i = chapter.start_page - 1; i < chapter.end_page; i++) {
        if (state.markdown_pages[i]) {
            content += state.markdown_pages[i] + "\n\n";
        }
    }
    return { name: chapter.chapter_name, content: content };
  });

  console.log(`--- Found ${chapters.length} chapters ---`);
  return { chapters };
};

// Node to generate QA pairs in parallel
const qaGeneratorNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log(`--- Generating Q&A for ${state.chapters.length} chapters in parallel ---`);

    const qaPromises = state.chapters.map(chapter => {
        console.log(`--- Starting QA generation for chapter: ${chapter.name} ---`);
        return qa_llm.invoke([
            new SystemMessage("You are an expert in creating high-quality question-answer pairs for learning from a given text. The questions should be meaningful and the answers concise and accurate. focus on facts, legal terms, technical knowledge and definitions. the user will learn with the qapairs and will not see the text. Respond in German."),
            new HumanMessage(`Generate question-answer pairs for the following chapter content:\n\nCHAPTER: ${chapter.name}\n\nCONTENT:\n${chapter.content}`),
        ]);
    });

    const results = await Promise.all(qaPromises);
    const all_qa_pairs = results.flatMap(result => result.qa_pairs);

    console.log(`--- Generated a total of ${all_qa_pairs.length} Q&A pairs ---`);
    return { qa_pairs: all_qa_pairs };
};


// Construct Graph
const workflow = new StateGraph<GraphState>({ channels })
  .addNode("create_chapters", createChaptersNode)
  .addNode("generate_qa", qaGeneratorNode);

workflow.addEdge(START, "create_chapters");
workflow.addEdge("create_chapters", "generate_qa");
workflow.addEdge("generate_qa", END);

const graph = workflow.compile();

const finalState = await graph.invoke({ markdown_pages: pages });

return NextResponse.json({ qaList: finalState.qa_pairs }, { status: 200 });
}
