/**
 * Trendyol Fiyat & Strateji Hesaplama Modülü
 *
 * Kargo Ücretleri (2026):
 *   0 - 149.99 TL  → 58.50 TL
 * 150 - 299.99 TL  → 95.50 TL
 * 300 - 399.99 TL  → 110.00 TL
 * 400+ TL          → 130.00 TL
 *
 * Platform Ücreti: 13.80 TL (sabit)
 */

class PriceCalculator {
    constructor() {
        this.shippingRanges = [
            { min: 0, max: 149.99, cost: 58.50 },
            { min: 150, max: 299.99, cost: 95.50 },
            { min: 300, max: 399.99, cost: 110 },
            { min: 400, max: Infinity, cost: 130 }
        ];
        this.platformFee = 13.80;
    }

    getShippingCost(salePrice) {
        const range = this.shippingRanges.find(r => salePrice >= r.min && salePrice <= r.max);
        return range ? range.cost : 130;
    }

    getCommissionAmount(salePrice, commissionRate) {
        return (salePrice * commissionRate) / 100;
    }

    getIdealMargin(costPrice) {
        if (costPrice <= 0) return 0.30;
        if (costPrice <= 25) return 0.50;
        if (costPrice <= 50) return 0.38;
        if (costPrice <= 100) return 0.30;
        if (costPrice <= 200) return 0.25;
        if (costPrice <= 400) return 0.22;
        return 0.18;
    }

    // Belirli fiyattan net kâr hesapla
    calcProfitAtPrice(salePrice, costPrice, commissionRate) {
        const shipping = this.getShippingCost(salePrice);
        const commission = this.getCommissionAmount(salePrice, commissionRate);
        return salePrice - shipping - commission - this.platformFee - costPrice;
    }

    // Önerilen fiyat hesapla
    calculateRecommendedPrice(costPrice, commissionRate) {
        if (costPrice <= 0) return 0;

        const idealMargin = this.getIdealMargin(costPrice);
        const targetProfit = costPrice * idealMargin;

        let price = costPrice + this.platformFee + targetProfit;
        for (let i = 0; i < 15; i++) {
            const shipping = this.getShippingCost(price);
            const newPrice = (costPrice + this.platformFee + shipping + targetProfit) / (1 - commissionRate / 100);
            if (Math.abs(newPrice - price) < 0.01) break;
            price = newPrice;
        }

        return Math.ceil(price * 100) / 100;
    }

    // Başabaş minimum fiyat
    calculateMinPrice(costPrice, commissionRate, targetProfit = 0) {
        let price = costPrice + this.platformFee + targetProfit;
        for (let i = 0; i < 15; i++) {
            const shipping = this.getShippingCost(price);
            const newPrice = (costPrice + this.platformFee + shipping + targetProfit) / (1 - commissionRate / 100);
            if (Math.abs(newPrice - price) < 0.01) break;
            price = newPrice;
        }
        return Math.ceil(price * 100) / 100;
    }

    /**
     * Komisyon Tarifesi Analizi — %100 GERÇEK VERİ
     * 
     * Demo/uydurma kırılım YOK. Tüm komisyon oranları sipariş geçmişinden alınır.
     * 
     * Veri kaynakları:
     *   1. Bu ürünün geçmiş siparişlerindeki komisyon değişimleri
     *   2. Mağazadaki TÜM ürünlerin gerçek komisyon oranları (hangi oranlar mevcut)
     *   3. Aynı fiyatta / düşük fiyatta komisyon farkı simülasyonu
     */
    generateCommissionTariffAnalysis(product, orderHistory = []) {
        const { salePrice, costPrice, commissionRate } = product;
        if (!costPrice || costPrice <= 0 || !salePrice) return null;

        // ========== 1. GERÇEK VERİ: Bu ürünün komisyon geçmişi ==========
        const productHistory = [];
        orderHistory.forEach(o => {
            if (o.lines) o.lines.forEach(l => {
                if (l.barcode === product.barcode && l.commission) {
                    productHistory.push({
                        rate: l.commission,
                        amount: l.amount,
                        price: l.price,
                        date: o.orderDate,
                        dateFormatted: new Date(o.orderDate).toLocaleDateString('tr-TR', {
                            day: '2-digit', month: '2-digit', year: 'numeric'
                        })
                    });
                }
            });
        });

        // ========== 2. GERÇEK VERİ: Mağazadaki tüm komisyon oranları ==========
        const allRatesMap = {}; // rate -> { count, barcodes, minPrice, maxPrice }
        orderHistory.forEach(o => {
            if (o.lines) o.lines.forEach(l => {
                if (l.commission && l.barcode) {
                    const rate = l.commission;
                    if (!allRatesMap[rate]) {
                        allRatesMap[rate] = { count: 0, barcodes: new Set(), minPrice: Infinity, maxPrice: 0 };
                    }
                    allRatesMap[rate].count++;
                    allRatesMap[rate].barcodes.add(l.barcode);
                    const price = l.amount || l.price || 0;
                    if (price < allRatesMap[rate].minPrice) allRatesMap[rate].minPrice = price;
                    if (price > allRatesMap[rate].maxPrice) allRatesMap[rate].maxPrice = price;
                }
            });
        });

        // Mağazadaki tüm gerçek oranlar (sıralı)
        const allRealRates = Object.keys(allRatesMap)
            .map(Number)
            .sort((a, b) => a - b);

        // Bu ürünün geçmiş oranları
        const productRates = [...new Set(productHistory.map(h => h.rate))].sort((a, b) => a - b);

        // ========== 3. HESAPLAMALAR ==========
        const currentProfit = this.calcProfitAtPrice(salePrice, costPrice, commissionRate);
        const currentShipping = this.getShippingCost(salePrice);
        const currentCommAmt = this.getCommissionAmount(salePrice, commissionRate);

        // Renk skalası: düşük=yeşil, yüksek=kırmızı
        const getColor = (rate) => {
            if (rate <= 15) return '#00d68f';
            if (rate <= 17) return '#4ecdc4';
            if (rate <= 18.5) return '#6c5ce7';
            if (rate <= 20) return '#f0932b';
            return '#ff6b6b';
        };

        const getLabel = (rate, info) => {
            const productCount = info.barcodes.size;
            return `${productCount} ürün, ${info.count} satış`;
        };

        // ========== 4. TARİFE SENARYOLARI (sadece mevcut orandan düşük GERÇEK oranlar) ==========
        const tariffScenarios = [];

        allRealRates.forEach(rate => {
            if (rate >= commissionRate) return; // Sadece düşük oranları göster

            const info = allRatesMap[rate];
            const rateDiff = commissionRate - rate;

            // Aynı fiyatta farklı komisyonla kâr
            const profitSamePrice = this.calcProfitAtPrice(salePrice, costPrice, rate);
            const commissionSaving = currentCommAmt - this.getCommissionAmount(salePrice, rate);

            // Bu oran bu ürünün geçmişinde var mı?
            const wasUsedBefore = productRates.includes(rate);

            // Örnek ürün barkodları (max 3)
            const exampleBarcodes = [...info.barcodes].slice(0, 3);

            // Fiyat düşürme senaryoları
            const priceDropScenarios = [];
            [5, 10, 15, 20, 25].forEach(dropPct => {
                const newPrice = Math.round(salePrice * (1 - dropPct / 100) * 100) / 100;
                if (newPrice < costPrice) return;

                const newProfit = this.calcProfitAtPrice(newPrice, costPrice, rate);
                const newShipping = this.getShippingCost(newPrice);
                const newCommAmt = this.getCommissionAmount(newPrice, rate);

                priceDropScenarios.push({
                    dropPercent: dropPct,
                    newPrice,
                    newShipping,
                    newCommission: newCommAmt,
                    newProfit,
                    profitDiff: newProfit - currentProfit,
                    isProfitable: newProfit > 0,
                    isBetter: newProfit > currentProfit
                });
            });

            const bestScenario = priceDropScenarios.find(s => s.isBetter) ||
                priceDropScenarios.find(s => s.isProfitable) ||
                (priceDropScenarios.length > 0 ? priceDropScenarios[0] : null);

            tariffScenarios.push({
                rate,
                label: getLabel(rate, info),
                color: getColor(rate),
                currentRate: commissionRate,
                rateSaving: rateDiff,
                profitAtSamePrice: profitSamePrice,
                commissionSaving,
                profitGainSamePrice: profitSamePrice - currentProfit,
                priceDropScenarios,
                bestScenario,
                wasUsedBefore,
                exampleBarcodes,
                priceRange: { min: info.minPrice, max: info.maxPrice },
                salesCount: info.count,
                productCount: info.barcodes.size,
                isReal: true, // Bu oran gerçek sipariş verisinden
                recommendation: profitSamePrice > currentProfit
                    ? `✅ Fiyat aynı kalsa bile %${rate} komisyonla ${this._fmt(profitSamePrice - currentProfit)} daha fazla kazanırsın!`
                    : bestScenario && bestScenario.isBetter
                    ? `📈 Fiyatı ${this._fmt(bestScenario.newPrice)}'e düşürsen %${rate} komisyonla ${this._fmt(bestScenario.profitDiff)} daha fazla kazanırsın`
                    : bestScenario && bestScenario.isProfitable
                    ? `⚠️ Fiyatı ${this._fmt(bestScenario.newPrice)}'e düşürsen hâlâ ${this._fmt(bestScenario.newProfit)} kâr edersin ama mevcut kârından az`
                    : '❌ Bu komisyon seviyesinde kârlı satış zor'
            });
        });

        return {
            currentRate: commissionRate,
            currentProfit,
            currentCommissionAmount: currentCommAmt,
            currentShipping,
            tariffScenarios,
            // Bu ürünün geçmiş oranları
            productRates,
            productHistory: productHistory.slice(-15),
            // Mağazadaki tüm gerçek oranlar
            allRealRates,
            allRatesInfo: Object.fromEntries(
                Object.entries(allRatesMap).map(([rate, info]) => [
                    rate,
                    { count: info.count, productCount: info.barcodes.size, minPrice: info.minPrice, maxPrice: info.maxPrice }
                ])
            ),
            // Fırsat var mı
            hasOpportunity: tariffScenarios.some(s => s.profitGainSamePrice > 0 || (s.bestScenario && s.bestScenario.isBetter)),
            bestOpportunity: tariffScenarios.find(s => s.profitGainSamePrice > 0) ||
                tariffScenarios.find(s => s.bestScenario && s.bestScenario.isBetter) || null
        };
    }

    _fmt(v) { return '₺' + (v || 0).toFixed(2); }

    /**
     * Ürün stratejisi oluştur - çift tıklama detay paneli için
     */
    generateStrategy(product, orderHistory = []) {
        const { salePrice, costPrice, commissionRate } = product;
        if (!costPrice || costPrice <= 0) return null;

        const strategy = {
            currentAnalysis: {},
            shippingTiers: [],
            sweetSpots: [],
            couponStrategy: null,
            campaignIdeas: [],
            recommendations: []
        };

        // Mevcut durum analizi
        const currentShipping = this.getShippingCost(salePrice);
        const currentCommission = this.getCommissionAmount(salePrice, commissionRate);
        const currentProfit = this.calcProfitAtPrice(salePrice, costPrice, commissionRate);
        strategy.currentAnalysis = {
            salePrice,
            costPrice,
            shipping: currentShipping,
            commission: currentCommission,
            platformFee: this.platformFee,
            totalDeductions: currentShipping + currentCommission + this.platformFee,
            netProfit: currentProfit,
            profitMargin: salePrice > 0 ? ((currentProfit / salePrice) * 100).toFixed(1) : 0
        };

        // Her kargo baremindeki kâr analizi
        this.shippingRanges.forEach(range => {
            const tierMax = range.max === Infinity ? 999 : range.max;
            const prices = [];

            // Baremin hemen altı (eşik noktası)
            if (range.min > 0) {
                const justBelow = range.min - 0.01;
                prices.push({ price: justBelow, label: `₺${justBelow.toFixed(2)} (barem altı)` });
            }

            // Baremin tam başı
            prices.push({ price: range.min || 50, label: `₺${range.min} (barem başı)` });

            // Baremin ortası
            const mid = range.max === Infinity ? range.min + 100 : (range.min + tierMax) / 2;
            prices.push({ price: mid, label: `₺${mid.toFixed(2)} (barem ortası)` });

            // Baremin hemen altı (üst sınır)
            if (range.max !== Infinity) {
                prices.push({ price: tierMax, label: `₺${tierMax.toFixed(2)} (barem sonu)` });
            }

            const tierData = {
                range: range.max === Infinity ? `₺${range.min}+` : `₺${range.min} - ₺${tierMax}`,
                shippingCost: range.cost,
                pricePoints: prices.map(p => ({
                    ...p,
                    profit: this.calcProfitAtPrice(p.price, costPrice, commissionRate),
                    shipping: range.cost
                }))
            };

            strategy.shippingTiers.push(tierData);
        });

        // Sweet spot'ları bul - barem geçiş noktaları
        const thresholds = [149.99, 150, 299.99, 300, 399.99, 400];
        thresholds.forEach(price => {
            const profit = this.calcProfitAtPrice(price, costPrice, commissionRate);
            const shipping = this.getShippingCost(price);
            if (profit > 0) {
                strategy.sweetSpots.push({
                    price,
                    profit,
                    shipping,
                    note: price <= 149.99
                        ? '🚚 En düşük kargo baremi (₺58.50)'
                        : price <= 299.99
                        ? '📦 Orta kargo baremi (₺95.50)'
                        : price <= 399.99
                        ? '📦 Yüksek kargo baremi (₺110)'
                        : '📦 En yüksek kargo baremi (₺130)'
                });
            }
        });

        // Kupon / İndirim stratejisi
        // Eğer ürün barem sınırının üstündeyse, müşteriye gösterilen fiyatı artır + kupon ekle
        const nextThreshold = thresholds.find(t => t > salePrice);
        const prevThreshold = [...thresholds].reverse().find(t => t <= salePrice);

        if (prevThreshold && salePrice > prevThreshold) {
            const profitAtPrev = this.calcProfitAtPrice(prevThreshold, costPrice, commissionRate);
            if (profitAtPrev > 0 && prevThreshold <= 149.99) {
                const showPrice = Math.ceil(salePrice * 1.15); // %15 yüksek göster
                const couponAmount = showPrice - prevThreshold;
                strategy.couponStrategy = {
                    showPrice,
                    couponAmount: Math.ceil(couponAmount),
                    finalPrice: prevThreshold,
                    profitAtFinal: profitAtPrev,
                    shippingSaved: this.getShippingCost(salePrice) - this.getShippingCost(prevThreshold),
                    note: `Ürünü ₺${showPrice} olarak göster, ₺${Math.ceil(couponAmount)} kupon ekle → Sepette ₺${prevThreshold.toFixed(2)} çıksın. Kargo ₺${this.getShippingCost(prevThreshold)} olur, ₺${(this.getShippingCost(salePrice) - this.getShippingCost(prevThreshold)).toFixed(2)} tasarruf!`
                };
            }
        }

        // Kampanya fikirleri
        if (currentProfit > costPrice * 0.3) {
            strategy.campaignIdeas.push({
                type: '2 Al 1 Öde',
                icon: '🎁',
                desc: `Kâr marjınız yüksek. "2 Al 1 Öde" kampanyası ile satış adedini artırabilirsiniz. Her 2 üründen ₺${(currentProfit * 2 - costPrice).toFixed(2)} kâr edersiniz.`
            });
        }

        if (currentProfit > 0) {
            const discountedPrice = Math.ceil(salePrice * 0.9);
            const discountedProfit = this.calcProfitAtPrice(discountedPrice, costPrice, commissionRate);
            strategy.campaignIdeas.push({
                type: '%10 İndirim',
                icon: '🏷️',
                desc: `%10 indirimle ₺${discountedPrice}'e satarsanız hâlâ ${discountedProfit > 0 ? '₺' + discountedProfit.toFixed(2) + ' kâr' : 'zarar'} edersiniz. ${discountedProfit > 0 ? 'Satış hızı artabilir.' : '⚠️ Zarara girer!'}`
            });
        }

        // 3 al 2 öde
        if (currentProfit > costPrice * 0.2) {
            strategy.campaignIdeas.push({
                type: '3 Al 2 Öde',
                icon: '🛒',
                desc: `3 ürün satıp 2 ürün fiyatı alırsanız: Gelir ₺${(salePrice * 2).toFixed(2)}, Maliyet ₺${(costPrice * 3).toFixed(2)}. Net: ₺${(salePrice * 2 - costPrice * 3 - this.getShippingCost(salePrice * 2) - this.getCommissionAmount(salePrice * 2, commissionRate) - this.platformFee).toFixed(2)}`
            });
        }

        // Öneriler
        const minPrice = this.calculateMinPrice(costPrice, commissionRate);
        const recommendedPrice = this.calculateRecommendedPrice(costPrice, commissionRate);

        strategy.recommendations.push({
            icon: '⚠️',
            title: 'Minimum Fiyat (Başabaş)',
            value: `₺${minPrice.toFixed(2)}`,
            desc: 'Bu fiyatın altında zarar edersiniz'
        });

        strategy.recommendations.push({
            icon: '✅',
            title: 'Önerilen Fiyat',
            value: `₺${recommendedPrice.toFixed(2)}`,
            desc: `₺${this.calcProfitAtPrice(recommendedPrice, costPrice, commissionRate).toFixed(2)} kâr (${(this.getIdealMargin(costPrice) * 100).toFixed(0)}% hedef marj)`
        });

        // Barem optimizasyonu
        if (salePrice > 150 && salePrice < 160) {
            const profit149 = this.calcProfitAtPrice(149.99, costPrice, commissionRate);
            if (profit149 > 0) {
                strategy.recommendations.push({
                    icon: '💡',
                    title: 'Barem Fırsatı!',
                    value: '₺149.99',
                    desc: `₺149.99'a düşürürsen kargo ₺58.50 olur (₺37 tasarruf). Net kâr: ₺${profit149.toFixed(2)}`
                });
            }
        }

        if (salePrice > 300 && salePrice < 320) {
            const profit299 = this.calcProfitAtPrice(299.99, costPrice, commissionRate);
            if (profit299 > 0) {
                strategy.recommendations.push({
                    icon: '💡',
                    title: 'Barem Fırsatı!',
                    value: '₺299.99',
                    desc: `₺299.99'a düşürürsen kargo ₺95.50 olur (₺14.50 tasarruf). Net kâr: ₺${profit299.toFixed(2)}`
                });
            }
        }

        return strategy;
    }

    // Tek ürün analizi
    analyzeProduct(product) {
        const salePrice = product.salePrice || 0;
        const costPrice = product.costPrice || 0;
        const commissionRate = product.commissionRate || 0;

        const shippingCost = this.getShippingCost(salePrice);
        const commissionAmount = this.getCommissionAmount(salePrice, commissionRate);
        const platformFee = this.platformFee;
        const totalDeductions = shippingCost + commissionAmount + platformFee;

        const netRevenue = salePrice - totalDeductions;
        const netProfit = netRevenue - costPrice;

        const recommendedPrice = this.calculateRecommendedPrice(costPrice, commissionRate);
        const idealMargin = this.getIdealMargin(costPrice);
        const recommendedProfit = recommendedPrice > 0
            ? this.calcProfitAtPrice(recommendedPrice, costPrice, commissionRate)
            : 0;

        return {
            productId: product.id || product.barcode,
            productName: product.title || product.productName,
            barcode: product.barcode,
            stockCode: product.stockCode || '',
            categoryName: product.categoryName || '',
            brand: product.brand || '',
            imageUrl: product.images?.[0]?.url || '',
            salePrice,
            listPrice: product.listPrice || salePrice,
            costPrice,
            commissionRate,
            commissionSource: product.commissionSource || '',

            deductions: {
                shipping: shippingCost,
                commission: commissionAmount,
                commissionRate,
                platformFee,
                total: totalDeductions
            },

            netRevenue,
            netProfit,
            profitMargin: salePrice > 0 ? ((netProfit / salePrice) * 100).toFixed(1) : 0,

            recommendedPrice,
            recommendedProfit,
            idealMarginPercent: (idealMargin * 100).toFixed(0)
        };
    }

    // Sipariş satırı analizi
    analyzeOrderLine(line, costPrice = 0) {
        const salePrice = line.amount || line.price || 0;
        const commissionRate = line.commission || 0;

        const shippingCost = this.getShippingCost(salePrice);
        const commissionAmount = this.getCommissionAmount(salePrice, commissionRate);
        const platformFee = this.platformFee;
        const totalDeductions = shippingCost + commissionAmount + platformFee;

        const netRevenue = salePrice - totalDeductions;
        const netProfit = netRevenue - costPrice;
        const quantity = line.quantity || 1;

        return {
            salePrice,
            listPrice: line.price || salePrice,
            costPrice,
            commissionRate,
            commissionAmount: commissionAmount * quantity,
            shippingCost: shippingCost * quantity,
            platformFee: platformFee * quantity,
            totalDeductions: totalDeductions * quantity,
            netRevenue: netRevenue * quantity,
            netProfit: netProfit * quantity,
            quantity
        };
    }

    // Toplu ürün analizi
    analyzeMultipleProducts(products) {
        const results = products.map(p => this.analyzeProduct(p));
        const withCost = results.filter(r => r.costPrice > 0);

        const summary = {
            totalProducts: results.length,
            withCostCount: withCost.length,
            profitable: withCost.filter(r => r.netProfit > 0).length,
            unprofitable: withCost.filter(r => r.netProfit < 0).length,
            noCost: results.filter(r => r.costPrice <= 0).length,
            totalProfit: withCost.reduce((sum, r) => sum + r.netProfit, 0)
        };

        return { products: results, summary };
    }

    // Fiyat simülasyonu
    simulatePrices(costPrice, commissionRate, priceRange = [100, 500], step = 50) {
        const simulations = [];
        for (let price = priceRange[0]; price <= priceRange[1]; price += step) {
            const result = this.analyzeProduct({ salePrice: price, costPrice, commissionRate });
            simulations.push({ salePrice: price, netRevenue: result.netRevenue, netProfit: result.netProfit });
        }
        return simulations;
    }
}

module.exports = new PriceCalculator();
