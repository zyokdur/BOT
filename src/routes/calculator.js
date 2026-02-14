const express = require('express');
const router = express.Router();
const priceCalculator = require('../services/priceCalculator');

// Maliyet veritabanı (in-memory)
let productCosts = {};

// Tek ürün analizi
router.post('/analyze', (req, res) => {
    try {
        const { salePrice, costPrice, commissionRate } = req.body;

        if (!salePrice || salePrice <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Geçerli bir satış fiyatı giriniz'
            });
        }

        const product = {
            salePrice: parseFloat(salePrice),
            costPrice: parseFloat(costPrice) || 0,
            commissionRate: parseFloat(commissionRate) || 0
        };

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

// Toplu ürün analizi
router.post('/analyze-bulk', (req, res) => {
    try {
        const { products } = req.body;

        if (!products || !Array.isArray(products) || products.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Geçerli ürün listesi giriniz'
            });
        }

        const analysis = priceCalculator.analyzeMultipleProducts(products);

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

// Minimum fiyat hesapla
router.post('/min-price', (req, res) => {
    try {
        const { costPrice, commissionRate, targetProfit } = req.body;

        if (!costPrice || costPrice <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Geçerli bir maliyet fiyatı giriniz'
            });
        }

        const minPrice = priceCalculator.calculateMinPrice(
            parseFloat(costPrice),
            parseFloat(commissionRate) || 0,
            parseFloat(targetProfit) || 0
        );

        const recommendedPrice = priceCalculator.calculateRecommendedPrice(
            parseFloat(costPrice),
            parseFloat(commissionRate) || 0,
            20 // %20 kar marjı
        );

        res.json({
            success: true,
            data: {
                costPrice: parseFloat(costPrice),
                commissionRate: parseFloat(commissionRate) || 0,
                minPriceForBreakEven: minPrice,
                recommendedPrice,
                platformFee: priceCalculator.platformFee,
                shippingEstimate: priceCalculator.getShippingCost(minPrice)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Fiyat simülasyonu
router.post('/simulate', (req, res) => {
    try {
        const { costPrice, commissionRate, minPrice, maxPrice, step } = req.body;

        if (!costPrice || costPrice <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Geçerli bir maliyet fiyatı giriniz'
            });
        }

        const simulations = priceCalculator.simulatePrices(
            parseFloat(costPrice),
            parseFloat(commissionRate) || 0,
            [parseFloat(minPrice) || 100, parseFloat(maxPrice) || 500],
            parseFloat(step) || 50
        );

        res.json({
            success: true,
            data: simulations
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Ürün maliyeti kaydet
router.post('/cost', (req, res) => {
    try {
        const { barcode, costPrice } = req.body;

        if (!barcode) {
            return res.status(400).json({
                success: false,
                error: 'Barkod gerekli'
            });
        }

        productCosts[barcode] = parseFloat(costPrice) || 0;

        res.json({
            success: true,
            message: 'Maliyet kaydedildi',
            data: { barcode, costPrice: productCosts[barcode] }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Toplu maliyet kaydet
router.post('/costs-bulk', (req, res) => {
    try {
        const { costs } = req.body;

        if (!costs || !Array.isArray(costs)) {
            return res.status(400).json({
                success: false,
                error: 'Geçerli maliyet listesi giriniz'
            });
        }

        costs.forEach(item => {
            if (item.barcode) {
                productCosts[item.barcode] = parseFloat(item.costPrice) || 0;
            }
        });

        res.json({
            success: true,
            message: `${costs.length} ürün maliyeti kaydedildi`,
            data: productCosts
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Tüm maliyetleri getir
router.get('/costs', (req, res) => {
    res.json({
        success: true,
        data: productCosts
    });
});

// Kargo ücret tablosu
router.get('/shipping-rates', (req, res) => {
    res.json({
        success: true,
        data: {
            platformFee: priceCalculator.platformFee,
            shippingRanges: priceCalculator.shippingRanges
        }
    });
});

module.exports = router;
