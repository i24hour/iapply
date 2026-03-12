'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useDashboardStore } from '@/stores/dashboard-store';
import { resumeApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { FileText, Upload, Loader2, CheckCircle, X } from 'lucide-react';
import { formatFileSize } from '@/lib/utils';

export default function ResumePage() {
  const { resume, setResume } = useDashboardStore();
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024, // 5MB
  });

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    try {
      const res = await resumeApi.upload(selectedFile);
      setResume(res.data);
      setSelectedFile(null);
      toast.success('Resume uploaded and parsed successfully!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to upload resume');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Resume</h1>
      <p className="text-gray-600 mb-8">
        Upload your resume to automatically extract your skills and experience.
      </p>

      {/* Upload Area */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
          isDragActive
            ? 'border-primary-500 bg-primary-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center">
          <Upload className="h-12 w-12 text-gray-400 mb-4" />
          <p className="text-lg font-medium text-gray-900 mb-1">
            {isDragActive ? 'Drop your resume here' : 'Drag & drop your resume'}
          </p>
          <p className="text-gray-600 mb-4">or click to browse</p>
          <p className="text-sm text-gray-500">PDF or DOCX, max 5MB</p>
        </div>
      </div>

      {/* Selected File */}
      {selectedFile && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary-600" />
            <div>
              <p className="font-medium">{selectedFile.name}</p>
              <p className="text-sm text-gray-600">{formatFileSize(selectedFile.size)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedFile(null)}
              className="p-2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                'Upload & Parse'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Current Resume */}
      {resume && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Current Resume</h2>
          <div className="bg-white border rounded-xl p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="font-medium">{resume.fileName}</p>
                <p className="text-sm text-gray-600">
                  Uploaded on {new Date(resume.uploadedAt).toLocaleDateString()}
                </p>
              </div>
            </div>

            {resume.parsedData && (
              <div className="space-y-4">
                <h3 className="font-medium text-gray-900">Extracted Information</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Name</p>
                    <p className="font-medium">{resume.parsedData.fullName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="font-medium">{resume.parsedData.email}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Phone</p>
                    <p className="font-medium">{resume.parsedData.phone || 'Not found'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Experience</p>
                    <p className="font-medium">{resume.parsedData.experienceYears} years</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-gray-600 mb-2">Skills</p>
                  <div className="flex flex-wrap gap-2">
                    {resume.parsedData.skills?.map((skill: string, i: number) => (
                      <span
                        key={i}
                        className="bg-primary-100 text-primary-700 px-3 py-1 rounded-full text-sm"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
