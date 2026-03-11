import mongoose from 'mongoose';

const automationCommandSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, default: 'pending' },
}, { timestamps: true });

export const AutomationCommand = mongoose.model('AutomationCommand', automationCommandSchema);
