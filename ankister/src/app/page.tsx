"use client";

import { useState } from 'react';

interface QAPair {
  question: string;
  answer: string;
}

export default function UploadPdfPage() {
  const [file, setFile] = useState<File | null>(null);
  const [qaList, setQaList] = useState<QAPair[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
      setError(null); // Clear previous errors
    } else {
      setFile(null);
      setError("Please select a PDF file.");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError("Please select a PDF file to upload.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setQaList([]); // Clear previous results

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/workflow/execute', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (result.qaList) {
        setQaList(result.qaList);
      } else {
        setError("No QA pairs found in the response.");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      console.error("Error uploading file:", err);
    }
    setIsLoading(false);
  };

  const handleDownloadAnki = async () => {
    if (qaList.length === 0) {
      setError("No Q&A pairs to download.");
      return;
    }

    setIsDownloading(true);
    setError(null);

    try {
      const deckName = file?.name.replace(/\.pdf$/i, '') || 'Generated Anki Deck';
      const response = await fetch('http://localhost:8000/generate-deck', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          title: deckName, 
          qa_list: qaList.map(qa => ({
            question: qa.question,
            answer: qa.answer
          }))
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to generate Anki deck: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Get the filename from the Content-Disposition header or use a default
      const contentDisposition = response.headers.get('content-disposition');
      let filename = `${deckName}.apkg`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1];
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during download.');
      console.error("Error downloading Anki deck:", err);
    }

    setIsDownloading(false);
  };

  return (
    <div className="max-w-3xl mx-auto my-10 p-8 bg-slate-50 rounded-xl shadow-lg text-slate-800">
      <h1 className="text-3xl font-bold mb-8 text-center text-slate-900">Upload PDF to Generate Q&A Pairs</h1>
      
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="mb-6">
          <label htmlFor="pdf-upload" className="block text-lg font-medium mb-2 text-slate-700">Choose PDF file:</label>
          <input 
            type="file" 
            id="pdf-upload" 
            accept="application/pdf" 
            onChange={handleFileChange} 
            className="w-full p-3 border border-slate-300 rounded-lg text-base bg-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>
        <button 
          type="submit" 
          disabled={!file || isLoading} 
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg text-lg font-semibold cursor-pointer transition-colors duration-200 ease-in-out"
        >
          {isLoading ? 'Processing...' : 'Upload and Generate'}
        </button>
      </form>

      {error && (
        <p className="text-red-600 bg-red-100 p-4 rounded-lg mb-6 text-center">Error: {error}</p>
      )}

      {isLoading && (
        <div className="text-center p-5">
          <p className="text-xl text-slate-600">Loading Q&A pairs...</p>
          {/* Consider adding a Tailwind spinner component here */}
        </div>
      )}

      {qaList.length > 0 && !isLoading && (
        <div className="mt-4 text-center">
            <button 
              onClick={handleDownloadAnki}
              disabled={isDownloading}
              className="py-3 px-6 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white rounded-lg text-lg font-semibold cursor-pointer transition-colors duration-200 ease-in-out"
            >
              {isDownloading ? 'Downloading...' : 'Download as Anki Deck'}
            </button>
        </div>
      )}

      {qaList.length > 0 && (
        <div>
          <h2 className="text-2xl font-semibold mb-6 text-slate-900 border-t border-slate-200 pt-8">Generated Q&A Pairs:</h2>
          <ul className="list-none p-0">
            {qaList.map((qa, index) => (
              <li key={index} className="bg-white mb-6 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
                <p className="font-semibold text-slate-800 mb-2 text-lg">Question:</p>
                <p className="text-slate-700 mb-4 leading-relaxed">{qa.question}</p>
                <p className="font-semibold text-slate-800 mb-2 text-lg">Answer:</p>
                <p className="text-slate-700 leading-relaxed">{qa.answer}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
