const express = require('express');
const router = express.Router();
const priceCalculator = require('../services/priceCalculator');

router.post('/analyze', (req, res) => {
    try {
        const { salePrice, costPrice, commissionRate } = req.body;
        if (!salePrice || salePrice <= 0) {
            return res.status(400).json({ success: false, error: 'Gecerli bir satis fiyati giriniz' });
        }
        const analysis = priceCalculator.analyzeProduct({
            salePrice: parseFloat(salePrice),
            costPrice: parseFloat(costPrice) || 0,
            commissionRate: parseFloat(commissionRate) || 0
        });
        res.json({ success: true, data: analysis });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/min-price', (req, res) => {
    try {
        const { costPrice, commissionRate, targetProfit } = req.body;
        if (!costPrice || costPrice <= 0) {
            return res.status(400).json({ success: false, error: 'Gecerli bir maliyet fiyati giriniz' });
        }
        const minPrice = priceCalculator.calculateMinPrice(
            parseFloat(costPrice), parseFloat(commissionRate) || 0, parseFloat(targetProfit) || 0
        );
        const recommendedPrice = priceCalculator.calculateRecommendedPrice(
            parseFloat(costPrice), parseFloat(commissionRate) || 0
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
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/simulate', (req, res) => {
    try {
        const { costPrice, commissionRate, minPrice, maxPrice, step } = req.body;
        if (!costPrice || costPrice <= 0) {
            return res.status(400).json({ success: false, error: 'Gecerli bir maliyet fiyati giriniz' });
        }
        const simulations = priceCalculator.simulatePrices(
            parseFloat(costPrice), parseFloat(commissionRate) || 0,
            [parseFloat(minPrice) || 100, parseFloat(maxPrice) || 500],
            parseFloat(step) || 50
        );
        res.json({ success: true, data: simulations });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/shipping-rates', (req, res) => {
    res.json({
        success: true,
        data: {
            platformFee: priceCalculator.platformFee,
            shippingRanges: priceCalculator.shippingRanges.map(r => ({
                ...r, max: r.max === Infinity ? 99999 : r.max
            }))
        }
    });
});

module.exports = router;
