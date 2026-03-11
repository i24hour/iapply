import mongoose from 'mongoose';

const jobPreferencesSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  roles: [String],
  locations: [String],
  remoteOnly: { type: Boolean, default: false },
  minSalary: Number,
  maxSalary: Number,
  experienceLevel: { type: String, default: 'any' },
  jobTypes: { type: [String], default: ['full-time'] },
}, { timestamps: true });

export const JobPreferences = mongoose.model('JobPreferences', jobPreferencesSchema);
