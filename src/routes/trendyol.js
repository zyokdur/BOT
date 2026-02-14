const express = require('express');
const router = express.Router();
const trendyolAPI = require('../services/trendyolAPI');
const priceCalculator = require('../services/priceCalculator');

// Maliyet veritabanı (in-memory, gerçek uygulamada veritabanı kullanılır)
let productCosts = {};

// Tüm ürünleri getir ve analiz et
router.get('/products', async (req, res) => {
    try {
        const products = await trendyolAPI.getAllProducts();
        
        // Her ürüne maliyet ve komisyon bilgisini ekle
        const productsWithCosts = products.map(p => ({
            ...p,
            costPrice: productCosts[p.barcode] || 0,
            commissionRate: p.categoryCommissionRate || 0
        }));

        // Finansal analiz yap
        const analysis = priceCalculator.analyzeMultipleProducts(productsWithCosts);

        res.json({
            success: true,
            data: analysis
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Tek bir ürünün detaylı analizi
router.get('/products/:barcode', async (req, res) => {
    try {
        const products = await trendyolAPI.getAllProducts();
        const product = products.find(p => p.barcode === req.params.barcode);

        if (!product) {
            return res.status(404).json({
                success: false,
                error: 'Ürün bulunamadı'
            });
        }

        product.costPrice = productCosts[product.barcode] || 0;
        product.commissionRate = product.categoryCommissionRate || 0;

        const analysis = priceCalculator.analyzeProduct(product);

        res.json({
            success: true,
            data: analysis
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Siparişleri getir
router.get('/orders', async (req, res) => {
    try {
        const { startDate, endDate, status } = req.query;
        const orders = await trendyolAPI.getOrders(
            startDate ? parseInt(startDate) : null,
            endDate ? parseInt(endDate) : null,
            status
        );

        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Finansal özet
router.get('/settlements', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const settlements = await trendyolAPI.getSettlements(
            startDate ? parseInt(startDate) : null,
            endDate ? parseInt(endDate) : null
        );

        res.json({
            success: true,
            data: settlements
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API bağlantı testi
router.get('/test', async (req, res) => {
    try {
        const products = await trendyolAPI.getProducts(0, 1);
        res.json({
            success: true,
            message: 'Trendyol API bağlantısı başarılı',
            sellerId: process.env.TRENDYOL_SELLER_ID,
            totalProducts: products.totalElements || 0
        });
    } catch (error) {
        // Test endpoint'i 200 dönsün ama hatayı göstersin
        res.json({
            success: false,
            message: 'API bağlantı hatası',
            error: error.message,
            statusCode: error.statusCode || 0,
            sellerId: process.env.TRENDYOL_SELLER_ID
        });
    }
});

module.exports = router;
