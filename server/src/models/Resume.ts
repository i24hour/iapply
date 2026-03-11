import mongoose from 'mongoose';

const resumeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  parsedData: mongoose.Schema.Types.Mixed,
  uploadedAt: { type: Date, default: Date.now },
}, { timestamps: true });

export const Resume = mongoose.model('Resume', resumeSchema);
