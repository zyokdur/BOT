/**
 * Trendyol Fiyat Hesaplama Modülü
 * 
 * Kargo Ücretleri (2026 güncel):
 * - 0 - 149.99 TL: 58.50 TL
 * - 150 - 299.99 TL: 95.50 TL
 * - 300 - 399.99 TL: 110 TL
 * - 400+ TL: 130 TL
 * 
 * Platform Ücreti: 13.80 TL (sabit her satışta)
 */

class PriceCalculator {
    constructor() {
        // Kargo ücret aralıkları
        this.shippingRanges = [
            { min: 0, max: 149.99, cost: 58.50 },
            { min: 150, max: 299.99, cost: 95.50 },
            { min: 300, max: 399.99, cost: 110 },
            { min: 400, max: Infinity, cost: 130 }
        ];

        // Sabit platform ücreti
        this.platformFee = 13.80;
    }

    /**
     * Fiyata göre kargo ücretini hesapla
     */
    getShippingCost(salePrice) {
        const range = this.shippingRanges.find(r => salePrice >= r.min && salePrice <= r.max);
        return range ? range.cost : 130; // Varsayılan en yüksek
    }

    /**
     * Komisyon tutarını hesapla
     */
    getCommissionAmount(salePrice, commissionRate) {
        return (salePrice * commissionRate) / 100;
    }

    /**
     * Tek bir ürün için tam finansal analiz
     */
    analyzeProduct(product) {
        const salePrice = product.salePrice || 0;
        const costPrice = product.costPrice || 0; // Manuel girilen maliyet
        const commissionRate = product.commissionRate || 0;

        // Kesintiler
        const shippingCost = this.getShippingCost(salePrice);
        const commissionAmount = this.getCommissionAmount(salePrice, commissionRate);
        const platformFee = this.platformFee;

        // Toplam kesinti
        const totalDeductions = shippingCost + commissionAmount + platformFee;

        // Net gelir (satış fiyatı - kesintiler)
        const netRevenue = salePrice - totalDeductions;

        // Kar/Zarar
        const profit = netRevenue - costPrice;
        const profitMargin = costPrice > 0 ? ((profit / costPrice) * 100) : 0;

        // Durum belirleme
        let status = 'kar';
        let statusMessage = 'Kârlı';
        let statusColor = 'green';

        if (profit < 0) {
            status = 'zarar';
            statusMessage = 'Zararlı';
            statusColor = 'red';
        } else if (profit === 0) {
            status = 'basabas';
            statusMessage = 'Başabaş';
            statusColor = 'orange';
        }

        // Minimum satış fiyatı hesapla (kar etmek için)
        const minPriceForProfit = this.calculateMinPrice(costPrice, commissionRate);

        // Önerilen fiyat (%20 kar marjı için)
        const recommendedPrice = this.calculateRecommendedPrice(costPrice, commissionRate, 20);

        return {
            productId: product.id || product.barcode,
            productName: product.title || product.productName,
            barcode: product.barcode,
            salePrice,
            costPrice,
            
            // Kesintiler
            deductions: {
                shipping: shippingCost,
                commission: commissionAmount,
                commissionRate,
                platformFee,
                total: totalDeductions
            },

            // Finansal sonuç
            netRevenue,
            profit,
            profitMargin: profitMargin.toFixed(2),

            // Durum
            status,
            statusMessage,
            statusColor,

            // Öneriler
            recommendations: {
                minPriceForProfit,
                recommendedPrice,
                priceIncrease: profit < 0 ? (minPriceForProfit - salePrice).toFixed(2) : 0
            }
        };
    }

    /**
     * Kar etmek için minimum fiyat hesapla
     */
    calculateMinPrice(costPrice, commissionRate, targetProfit = 0) {
        // Formül: minPrice = (cost + platformFee + shipping + targetProfit) / (1 - commissionRate/100)
        // Kargo ücreti fiyata bağlı olduğu için iteratif hesaplama gerekiyor

        let price = costPrice + this.platformFee + targetProfit;
        let iterations = 0;
        const maxIterations = 10;

        while (iterations < maxIterations) {
            const shipping = this.getShippingCost(price);
            const newPrice = (costPrice + this.platformFee + shipping + targetProfit) / (1 - commissionRate / 100);
            
            if (Math.abs(newPrice - price) < 0.01) {
                break;
            }
            price = newPrice;
            iterations++;
        }

        return Math.ceil(price * 100) / 100; // Yukarı yuvarla
    }

    /**
     * Hedef kar marjıyla önerilen fiyat hesapla
     */
    calculateRecommendedPrice(costPrice, commissionRate, targetProfitMargin = 20) {
        const targetProfit = costPrice * (targetProfitMargin / 100);
        return this.calculateMinPrice(costPrice, commissionRate, targetProfit);
    }

    /**
     * Toplu ürün analizi
     */
    analyzeMultipleProducts(products) {
        const results = products.map(p => this.analyzeProduct(p));
        
        // Özet istatistikler
        const summary = {
            totalProducts: results.length,
            profitable: results.filter(r => r.status === 'kar').length,
            unprofitable: results.filter(r => r.status === 'zarar').length,
            breakEven: results.filter(r => r.status === 'basabas').length,
            totalProfit: results.reduce((sum, r) => sum + r.profit, 0),
            averageMargin: results.length > 0 
                ? (results.reduce((sum, r) => sum + parseFloat(r.profitMargin), 0) / results.length).toFixed(2)
                : 0
        };

        return { products: results, summary };
    }

    /**
     * Fiyat simülasyonu - farklı fiyatlarla sonuçları göster
     */
    simulatePrices(costPrice, commissionRate, priceRange = [100, 500], step = 50) {
        const simulations = [];
        
        for (let price = priceRange[0]; price <= priceRange[1]; price += step) {
            const result = this.analyzeProduct({
                salePrice: price,
                costPrice,
                commissionRate
            });
            simulations.push({
                salePrice: price,
                netRevenue: result.netRevenue,
                profit: result.profit,
                profitMargin: result.profitMargin,
                status: result.status
            });
        }

        return simulations;
    }
}

module.exports = new PriceCalculator();
