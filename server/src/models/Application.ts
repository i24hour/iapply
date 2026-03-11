import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  status: { type: String, default: 'pending' },
  screenshotUrl: String,
  appliedAt: Date,
  errorMessage: String,
  createdAt: { type: Date, default: Date.now },
});

export const Application = mongoose.model('Application', applicationSchema);
