import { useRef, useState } from 'react';

export default function UploadZone({ onFileSelect }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onFileSelect(files[0]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (e) => {
    if (e.target.files.length > 0) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
        transition-all duration-300 ease-in-out group
        ${isDragging
          ? 'border-brand-400 bg-brand-50/50 scale-[1.02]'
          : 'border-gray-200 bg-gray-50/50 hover:border-brand-300 hover:bg-brand-50/30'
        }
      `}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleChange}
        accept=".pdf,.txt"
        className="hidden"
      />
      <div className="flex flex-col items-center gap-3">
        <div className={`
          w-14 h-14 rounded-xl flex items-center justify-center transition-all duration-300
          ${isDragging 
            ? 'bg-brand-100 text-brand-600 scale-110' 
            : 'bg-gray-100 text-gray-400 group-hover:bg-brand-100 group-hover:text-brand-500'
          }
        `}>
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-700">
            {isDragging ? 'Drop your file here' : 'Drag PDF or TXT here or click to upload'}
          </p>
          <p className="text-xs text-gray-400 mt-1">Supports PDF and TXT files up to 5MB</p>
        </div>
      </div>
    </div>
  );
}
