const mongoose = require('mongoose');

const timedScoreSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:   { type: String, required: true },   // 'YYYY-MM-DD'
  points: { type: Number, required: true },
}, { timestamps: true });

// Índice para acelerar las queries del leaderboard
timedScoreSchema.index({ date: 1, points: -1 });
timedScoreSchema.index({ userId: 1, date: 1 });

module.exports = mongoose.model('TimedScore', timedScoreSchema);
