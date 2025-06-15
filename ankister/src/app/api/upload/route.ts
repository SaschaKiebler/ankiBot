import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
        }

        // Ensure the file is a PDF (optional, but good practice)
        if (file.type !== 'application/pdf') {
            return NextResponse.json({ error: 'Invalid file type. Only PDF is allowed.' }, { status: 400 });
        }

        const llamaCloudApiKey = process.env.LLAMA_CLOUD_API_KEY;
        if (!llamaCloudApiKey) {
            console.error('LLAMA_CLOUD_API_KEY is not set in environment variables.');
            return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
        }

        const llamaFormData = new FormData();
        llamaFormData.append('file', file, file.name);
        // LlamaIndex might require other form fields, e.g., 'filename_as_doc_id': 'true'
        // llamaFormData.append('filename_as_doc_id', 'true');

        const config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: 'https://api.cloud.llamaindex.ai/api/v1/parsing/upload',
            headers: {
                // 'Content-Type': 'multipart/form-data' will be set by axios with the correct boundary
                'Accept': 'application/json',
                'Authorization': `Bearer ${llamaCloudApiKey}`
            },
            data: llamaFormData
        };

        const response = await axios.request(config);
        console.log('LlamaIndex API Response:', JSON.stringify(response.data));
        return NextResponse.json(response.data, { status: response.status });

    } catch (error: any) {
        console.error('Error uploading to LlamaIndex:', error.response ? error.response.data : error.message);
        if (axios.isAxiosError(error) && error.response) {
            return NextResponse.json(
                { error: 'Failed to upload to LlamaIndex.', details: error.response.data },
                { status: error.response.status }
            );
        }
        return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
    }
}