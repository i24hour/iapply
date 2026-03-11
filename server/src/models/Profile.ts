import mongoose from 'mongoose';

const profileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  fullName: { type: String, required: true },
  phone: String,
  location: String,
  skills: [String],
  experienceYears: { type: Number, default: 0 },
  preferredRoles: [String],
}, { timestamps: true });

export const Profile = mongoose.model('Profile', profileSchema);
