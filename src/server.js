const path = require('path');

// Yakalanmayan hataları logla ama sunucuyu çökertme
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason?.message || reason);
});

// Proje kök dizinine git (CWD farklı olabilir)
const projectRoot = path.join(__dirname, '..');
process.chdir(projectRoot);

require('dotenv').config({ path: path.join(projectRoot, '.env') });
const express = require('express');
const cors = require('cors');

const trendyolRoutes = require('./routes/trendyol');
const calculatorRoutes = require('./routes/calculator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/trendyol', trendyolRoutes);
app.use('/api/calculator', calculatorRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde calisiyor`);
    console.log(`Trendyol Satici ID: ${process.env.TRENDYOL_SELLER_ID}`);
});
