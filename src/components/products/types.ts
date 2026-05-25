export interface ProductDetailPayload {
    success: true;
    product: {
        id: number;
        sku: string;
        product_title: string | null;
        category: string | null;
        gtin: string | null;
        upc: string | null;
        image_url: string | null;
        is_active: boolean;
        zoho_item_id: string | null;
    };
    platforms: Array<{
        id: number;
        platform: string;
        platform_sku: string | null;
        platform_item_id: string | null;
        account_name: string | null;
        display_name: string | null;
        image_url: string | null;
        is_active: boolean;
    }>;
    stock: {
        warehouse_qty: number;
        units_by_status: Array<{ status: string; count: number }>;
    };
}
