"use client";

import React, { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';

const POLLING_INTERVAL = 5000; // 5 seconds
const MAX_POLLS = 12; // Max 1 minute of polling (12 * 5s)

type UploadStatus =
  | 'idle'
  | 'fileSelected'
  | 'uploading'
  | 'uploadError'
  | 'processing'
  | 'fetchingMarkdown'
  | 'markdownSuccess'
  | 'markdownError'
  | 'generatingQA'
  | 'qaSuccess'
  | 'qaError';

const PdfUploadDropzone: React.FC = () => {
  // Helper function to trigger file download
  const triggerDownload = (content: string, fileName: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [message, setMessage] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const pollCountRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetState = () => {
    setSelectedFile(null);
    setUploadStatus('idle');
    setMessage('');
    setJobId(null);
    setMarkdownContent(null);
    pollCountRef.current = 0;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Do not reset jobId if markdown was successful, as it's needed for QA generation
    // setJobId(null); 
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    resetState(); // Reset on new file selection
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      if (file.type === 'application/pdf') {
        setSelectedFile(file);
        setUploadStatus('fileSelected');
        setMessage(`Selected file: ${file.name}`);
      } else {
        setUploadStatus('uploadError');
        setMessage('Invalid file type. Please upload a PDF.');
      }
    }
  };

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    resetState(); // Reset on new file drop
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
      if (file.type === 'application/pdf') {
        setSelectedFile(file);
        setUploadStatus('fileSelected');
        setMessage(`Selected file: ${file.name}`);
      } else {
        setUploadStatus('uploadError');
        setMessage('Invalid file type. Please upload a PDF.');
      }
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }, [isDragging]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isDragging) setIsDragging(false);
  }, [isDragging]);

  const fetchMarkdownResult = useCallback(async (currentJobId: string) => {
    if (!currentJobId) return;
    setUploadStatus('fetchingMarkdown');
    setMessage('Fetching processed markdown...');
    pollCountRef.current += 1;

    try {
      const response = await axios.get(`/api/parsing-result/${currentJobId}`);
      setMarkdownContent(response.data.markdown);
      setUploadStatus('markdownSuccess');
      setMessage('Markdown content fetched successfully!');
      setSelectedFile(null); // Clear file after full success
      pollCountRef.current = 0; // Reset poll count
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    } catch (error: any) {
      const errorData = error.response?.data;
      const statusCode = error.response?.status;
      console.error('Error fetching markdown:', errorData || error.message);

      // Specific LlamaIndex status codes that might indicate processing is ongoing or recoverable
      // e.g., 404 (Not Found if result isn't ready) or 422 (Unprocessable Entity if job failed or not ready)
      // This part needs to be aligned with actual LlamaCloud API behavior for pending jobs.
      // For now, let's assume 404 or specific error messages mean it's still processing.
      const isStillProcessing = 
        statusCode === 404 || 
        (statusCode === 422 && errorData?.details?.error?.includes('Job not finished')); // Example condition

      if (isStillProcessing && pollCountRef.current < MAX_POLLS) {
        setMessage(`Processing document (attempt ${pollCountRef.current}/${MAX_POLLS})... Please wait.`);
        timeoutRef.current = setTimeout(() => fetchMarkdownResult(currentJobId), POLLING_INTERVAL);
      } else if (isStillProcessing && pollCountRef.current >= MAX_POLLS) {
        setUploadStatus('markdownError');
        setMessage('Failed to fetch markdown: Processing timed out. Please try again later.');
        pollCountRef.current = 0;
      } else {
        setUploadStatus('markdownError');
        setMessage(`Failed to fetch markdown: ${errorData?.error || errorData?.details?.error || error.message || 'Unknown error'}`);
        pollCountRef.current = 0;
      }
    }
  }, []);

  useEffect(() => {
    // Cleanup timeout on component unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async () => {
    if (!selectedFile) {
      setMessage('Please select a PDF file to upload.');
      setUploadStatus('uploadError');
      return;
    }

    setUploadStatus('uploading');
    setMessage('Uploading PDF...');
    setMarkdownContent(null); // Clear previous markdown
    pollCountRef.current = 0; // Reset poll count for new upload
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      const newJobId = response.data.id; // Assuming LlamaIndex returns an 'id' for the job
      if (!newJobId) {
        throw new Error('Job ID not found in upload response.');
      }
      setJobId(newJobId);
      setUploadStatus('processing'); // Initial status after successful upload
      setMessage('PDF uploaded. Starting to process document...'); 
      // setSelectedFile(null); // Don't clear selected file yet, user might want to see it until markdown is fetched
      
      // Start polling for the markdown result
      timeoutRef.current = setTimeout(() => fetchMarkdownResult(newJobId), POLLING_INTERVAL / 2); // Start first poll a bit sooner

    } catch (error: any) {
      setUploadStatus('uploadError');
      const errorMessage = error.response?.data?.error || error.response?.data?.details?.error || error.message || 'Upload failed. Please try again.';
      setMessage(`Error: ${errorMessage}`);
      console.error('Upload error:', error.response ? error.response.data : error);
      setSelectedFile(null); // Clear file on upload error
    }
  };

  const inputRef = React.useRef<HTMLInputElement>(null);

  const getStatusColor = () => {
    switch (uploadStatus) {
      case 'uploading':
      case 'processing':
      case 'fetchingMarkdown':
      // case 'generatingQA': // Covered by its own spinner, but message uses getStatusColor
        return 'bg-blue-100 text-blue-700';
      case 'markdownSuccess':
      case 'qaSuccess':
        return 'bg-green-100 text-green-700';
      case 'uploadError':
      case 'markdownError':
      case 'qaError':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const canShowUploadButton = selectedFile && !['uploading', 'processing', 'fetchingMarkdown', 'generatingQA'].includes(uploadStatus);

  const handleGenerateQA = async (currentJobId: string) => {
    if (!currentJobId) {
      setMessage('Job ID is missing, cannot generate QA cards.');
      setUploadStatus('qaError');
      return;
    }

    setUploadStatus('generatingQA');
    setMessage('Generating QA cards with AI... This may take a moment.');
    console.log('Attempting to generate QA for jobId:', currentJobId); // DEBUG LINE

    try {
      // Assuming your /api/generate/[job_id] is a POST request as per your setup
      const response = await axios.post(`/api/generate/${currentJobId}`);
      const fileContent = response.data.fileContent;
      const fileName = response.data.fileName;
      const contentType = "text/html";
      triggerDownload(fileContent, fileName, contentType);
      setUploadStatus('qaSuccess');
      setMessage(`QA cards generated and download started for ${fileName}!`);

    } catch (error: any) {
      setUploadStatus('qaError');
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Failed to generate QA cards.';
      setMessage(`Error generating QA cards: ${errorMessage}`);
      console.error('QA generation error:', error.response ? error.response.data : error);
    }
  };

  return (
    <div className="flex flex-col items-center p-6 border-2 border-dashed border-gray-300 rounded-lg w-full max-w-lg mx-auto space-y-4">
      {uploadStatus !== 'markdownSuccess' && (
        <div
          className={`w-full p-10 text-center cursor-pointer rounded-md transition-colors 
                      ${isDragging ? 'bg-blue-100 border-blue-400' : 'bg-gray-50 hover:bg-gray-100 border-gray-300'}`}
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input
            type="file"
            ref={inputRef}
            onChange={handleFileChange}
            accept="application/pdf"
            className="hidden"
            disabled={['uploading', 'processing', 'fetchingMarkdown'].includes(uploadStatus)}
          />
          <p className="text-gray-500">
            {isDragging ? 'Drop the PDF here!' : (selectedFile ? `File: ${selectedFile.name}` : 'Drag & drop a PDF file here, or click to select')}
          </p>
        </div>
      )}

      {message && (
        <div 
          className={`text-sm p-3 rounded-md w-full text-center ${getStatusColor()}`}
        >
          {message}
        </div>
      )}

      {canShowUploadButton && (
        <button
          onClick={handleSubmit}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
        >
          Upload PDF and Process
        </button>
      )}

      {markdownContent && uploadStatus === 'markdownSuccess' && (
        <div className="w-full mt-6 p-4 border border-gray-200 rounded-md bg-gray-50">
          <h3 className="text-lg font-semibold mb-2 text-gray-800">Processed Markdown:</h3>
          <pre className="whitespace-pre-wrap bg-white p-3 rounded text-sm text-gray-700 overflow-x-auto max-h-96">
            {markdownContent}
          </pre>
          <button
            onClick={resetState} // Allow uploading another file
            className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-50"
          >
            Upload Another PDF
          </button>
          {jobId && (
            <button
              onClick={() => handleGenerateQA(jobId)}
              disabled={false} // When in 'markdownSuccess' state, this button is enabled.
              className="mt-4 px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50"
            >
              {'Generate QA Cards'} {/* Static text when in 'markdownSuccess' state. */}
            </button>
          )}
        </div>
      )}
      
      {(uploadStatus === 'processing' || uploadStatus === 'fetchingMarkdown') && (
        <div className="mt-4 flex items-center justify-center space-x-2 text-blue-700">
            <svg className="animate-spin h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>{message || 'Processing...'}</span>
        </div>
      )}

      {uploadStatus === 'generatingQA' && (
        <div className="mt-4 flex items-center justify-center space-x-2 text-green-700">
            <svg className="animate-spin h-5 w-5 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Generating QA Cards...</span>
        </div>
      )}
    </div>
  );
};

export default PdfUploadDropzone;
