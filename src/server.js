require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const trendyolRoutes = require('./routes/trendyol');
const calculatorRoutes = require('./routes/calculator');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/trendyol', trendyolRoutes);
app.use('/api/calculator', calculatorRoutes);

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Sunucu http://localhost:${PORT} adresinde çalışıyor`);
    console.log(`📦 Trendyol Satıcı ID: ${process.env.TRENDYOL_SELLER_ID}`);
});
