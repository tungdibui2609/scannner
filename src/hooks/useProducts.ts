import { useState, useEffect } from "react";
import { Product } from "@/types/lot"; // Assuming type definition exists or will be created

export function useProducts() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [productMap, setProductMap] = useState<Record<string, Product>>({});

    useEffect(() => {
        fetchProducts();
    }, []);

    const fetchProducts = async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/products"); // Note: You might need to migrate this API too if scanner needs it
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    setProducts(data);
                    const map: Record<string, Product> = {};
                    data.forEach((p) => {
                        if (p.code) map[p.code.toLowerCase()] = p;
                    });
                    setProductMap(map);
                }
            }
        } catch (e) {
            console.error("Failed to fetch products", e);
        } finally {
            setLoading(false);
        }
    };

    const getProduct = (code: string) => {
        return productMap[code.toLowerCase()] || null;
    };

    return { products, productMap, loading, refresh: fetchProducts, getProduct };
}
