import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema({
  platform: { type: String, required: true },
  externalId: { type: String, required: true },
  company: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  location: { type: String, required: true },
  url: { type: String, required: true },
  salary: String,
  isEasyApply: { type: Boolean, default: false },
  postedAt: Date,
  scrapedAt: { type: Date, default: Date.now },
});

jobSchema.index({ platform: 1, externalId: 1 }, { unique: true });

export const Job = mongoose.model('Job', jobSchema);
