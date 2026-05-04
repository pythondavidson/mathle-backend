const mongoose = require('mongoose');

const dailyScoreSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:     { type: String, required: true }, // formato YYYY-MM-DD
  attempts: { type: Number, required: true, min: 1, max: 6 },
  points:   { type: Number, required: true, default: 0 },
  won:      { type: Boolean, default: false },
}, { timestamps: true });

// Un usuario solo puede tener un score por día
dailyScoreSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyScore', dailyScoreSchema);
