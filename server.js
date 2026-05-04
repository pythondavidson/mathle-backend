
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const dailyRoutes = require('./routes/daily');
const timedRoutes = require('./routes/timed');
const authRoutes = require('./routes/auth');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Error MongoDB:', err));

app.get('/', (req, res) => res.json({ status: 'Mathle API running' }));
app.use('/api/daily', dailyRoutes);
app.use('/api/timed', timedRoutes);

app.use('/api/auth', authRoutes);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));