
import PdfUploadDropzone from '@/components/PdfUploadDropzone';

export default function Home() {
  return (
    <div className="grid grid-rows-[auto_1fr_auto] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <header className="row-start-1 flex justify-center w-full">
        <h1 className="text-3xl font-bold text-gray-800">Upload Your PDF</h1>
      </header>
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start w-full">
        <PdfUploadDropzone />
      </main>
      <footer className="row-start-3 flex gap-[24px] flex-wrap items-center justify-center">
        <p className="text-sm text-gray-500">© {new Date().getFullYear()} AnkiBot</p>
      </footer>
    </div>
  );
}
