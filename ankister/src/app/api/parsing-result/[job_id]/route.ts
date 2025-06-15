import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: { job_id: string } }
) {
  const { job_id } = params;

  if (!job_id) {
    return NextResponse.json({ error: 'Job ID is required.' }, { status: 400 });
  }

  const llamaCloudApiKey = process.env.LLAMA_CLOUD_API_KEY;
  if (!llamaCloudApiKey) {
    console.error('LLAMA_CLOUD_API_KEY is not set in environment variables.');
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  }

  const url = `https://api.cloud.llamaindex.ai/api/v1/parsing/job/${job_id}/result/raw/markdown`;

  try {
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: url,
      headers: {
        'Accept': 'text/plain', // LlamaIndex likely returns raw markdown as text/plain
        'Authorization': `Bearer ${llamaCloudApiKey}`
      },
      // It's good to set responseType if you expect plain text to avoid issues with axios trying to parse JSON
      responseType: 'text' as const 
    };

    // console.log(`Fetching markdown for job_id: ${job_id} from ${url}`);
    const response = await axios.request(config);
    
    // The response.data should be the raw markdown string due to responseType: 'text'
    // console.log('LlamaIndex Raw Markdown Response:', response.data);

    // Ensure the directory exists and save response.data to file
    try {
      const dirPath = path.join(process.cwd(), 'md-files');
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
      }
      const filePath = path.join(dirPath, `${job_id}.md`);
      fs.writeFileSync(filePath, response.data);
      console.log(`Markdown content saved to: ${filePath}`);
    } catch (fileError: any) {
      console.error('Error saving markdown file:', fileError.message);
      // Decide if this error should prevent sending response to client
      // For now, we'll log it and continue, but you might want to return an error
    }
    
    // We'll return it as JSON with a markdown field for easier handling on the client
    return NextResponse.json({ markdown: response.data }, { status: 200 });

  } catch (error: any) {
    console.error(`Error fetching markdown for job_id ${job_id}:`, error.response ? error.response.data : error.message);
    // LlamaIndex might return 404 if the job is not found or not yet completed/available
    // Or 422 if the job failed or output is not available.
    if (axios.isAxiosError(error) && error.response) {
        // If LlamaIndex returns plain text error, error.response.data might be a string
        // If it returns JSON error, it would be an object.
        let details = error.response.data;
        if (typeof details === 'string' && details.startsWith('<!DOCTYPE html>')) {
            details = 'Received HTML error page from LlamaIndex.';
        } else if (typeof details === 'string') {
            try {
                details = JSON.parse(details); // Try to parse if it's a JSON string
            } catch (e) {
                // Keep as string if not parsable JSON
            }
        }

        return NextResponse.json(
            { 
              error: 'Failed to fetch markdown from LlamaIndex.', 
              details: details,
              status_code: error.response.status
            },
            { status: error.response.status }
        );
    }
    return NextResponse.json({ error: 'An unexpected error occurred while fetching markdown.' }, { status: 500 });
  }
}
