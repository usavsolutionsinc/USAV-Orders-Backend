#!/usr/bin/env python3
"""
Sync data from Google Sheets to Neon Postgres database.
Handles all sheet instances: orders, tech_0-2, receiving, Packer_0-1, shipped, sku-stock, sku
"""

import os
import json
import requests
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime
from dotenv import load_dotenv
from typing import List, Dict, Any, Optional

# Load environment variables
load_dotenv('.env.local')

DATABASE_URL = os.getenv('DATABASE_URL')
GOOGLE_CLIENT_EMAIL = os.getenv('GOOGLE_CLIENT_EMAIL')
GOOGLE_PRIVATE_KEY = os.getenv('GOOGLE_PRIVATE_KEY')
APPS_SCRIPT_WEBAPP_URL = os.getenv('APPS_SCRIPT_WEBAPP_URL')
GOOGLE_SHEET_ID = os.getenv('GOOGLE_SHEET_ID')

if not all([DATABASE_URL, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY]):
    raise ValueError("Required environment variables are not set")

def get_db_connection():
    """Get database connection"""
    return psycopg2.connect(DATABASE_URL, sslmode='require')

def parse_date(date_str: Optional[str]) -> Optional[str]:
    """Parse date string from Google Sheets to PostgreSQL format"""
    if not date_str or date_str == '':
        return None
    try:
        # Try various date formats
        for fmt in ['%m/%d/%Y', '%Y-%m-%d', '%m-%d-%Y', '%d/%m/%Y']:
            try:
                dt = datetime.strptime(str(date_str).strip(), fmt)
                return dt.strftime('%Y-%m-%d')
            except:
                continue
        return None
    except:
        return None

def parse_timestamp(timestamp_str: Optional[str]) -> Optional[str]:
    """Parse timestamp string from Google Sheets"""
    if not timestamp_str or timestamp_str == '':
        return None
    try:
        # Try various timestamp formats
        for fmt in ['%m/%d/%Y %H:%M:%S', '%Y-%m-%d %H:%M:%S', '%m/%d/%Y %H:%M']:
            try:
                dt = datetime.strptime(str(timestamp_str).strip(), fmt)
                return dt.strftime('%Y-%m-%d %H:%M:%S')
            except:
                continue
        return None
    except:
        return None

def sync_orders(conn, data: List[Dict[str, Any]]):
    """Sync orders data"""
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute("""
                INSERT INTO orders (
                    id, buyer_name, product_title, qty, ship_by, sku,
                    shipping_speed, tracking_number, status, item_index,
                    asin, oos_needed, notes, receiving_tracking
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    buyer_name = EXCLUDED.buyer_name,
                    product_title = EXCLUDED.product_title,
                    qty = EXCLUDED.qty,
                    ship_by = EXCLUDED.ship_by,
                    sku = EXCLUDED.sku,
                    shipping_speed = EXCLUDED.shipping_speed,
                    tracking_number = EXCLUDED.tracking_number,
                    status = EXCLUDED.status,
                    item_index = EXCLUDED.item_index,
                    asin = EXCLUDED.asin,
                    oos_needed = EXCLUDED.oos_needed,
                    notes = EXCLUDED.notes,
                    receiving_tracking = EXCLUDED.receiving_tracking
            """, (
                row.get('id') or row.get('ID'),
                row.get('buyer_name') or row.get('Buyer Name'),
                row.get('product_title') or row.get('Product Title'),
                int(row.get('qty') or row.get('Qty') or 0) if row.get('qty') or row.get('Qty') else None,
                parse_date(row.get('ship_by') or row.get('Ship By')),
                row.get('sku') or row.get('SKU'),
                row.get('shipping_speed') or row.get('Shipping Speed'),
                row.get('tracking_number') or row.get('Tracking Number'),
                row.get('status') or row.get('Status') or 'Pending',
                row.get('item_index') or row.get('Item Index'),
                row.get('asin') or row.get('ASIN'),
                row.get('oos_needed') or row.get('OOS Needed'),
                row.get('notes') or row.get('Notes'),
                row.get('receiving_tracking') or row.get('Receiving Tracking')
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} orders")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing orders: {e}")
        raise
    finally:
        cur.close()

def sync_tech_table(conn, tech_num: int, data: List[Dict[str, Any]]):
    """Sync tech table data"""
    table_name = f"tech_{tech_num}"
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute(f"""
                INSERT INTO {table_name} (
                    order_id, tracking_number, product_title, sku,
                    status, serial_numbers, notes, tech_id, timestamp
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                row.get('order_id') or row.get('Order ID'),
                row.get('tracking_number') or row.get('Tracking Number'),
                row.get('product_title') or row.get('Product Title'),
                row.get('sku') or row.get('SKU'),
                row.get('status') or row.get('Status'),
                row.get('serial_numbers') or row.get('Serial Numbers'),
                row.get('notes') or row.get('Notes'),
                str(tech_num),
                parse_timestamp(row.get('timestamp') or row.get('Timestamp')) or datetime.now()
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} rows to {table_name}")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing {table_name}: {e}")
        raise
    finally:
        cur.close()

def sync_packer_table(conn, packer_num: int, data: List[Dict[str, Any]]):
    """Sync packer table data"""
    table_name = f"Packer_{packer_num}"
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute(f"""
                INSERT INTO {table_name} (
                    order_id, tracking_number, product_title, sku,
                    qty, status, notes, packer_id, timestamp
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                row.get('order_id') or row.get('Order ID'),
                row.get('tracking_number') or row.get('Tracking Number'),
                row.get('product_title') or row.get('Product Title'),
                row.get('sku') or row.get('SKU'),
                int(row.get('qty') or row.get('Qty') or 0) if row.get('qty') or row.get('Qty') else None,
                row.get('status') or row.get('Status'),
                row.get('notes') or row.get('Notes'),
                str(packer_num),
                parse_timestamp(row.get('timestamp') or row.get('Timestamp')) or datetime.now()
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} rows to {table_name}")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing {table_name}: {e}")
        raise
    finally:
        cur.close()

def sync_receiving(conn, data: List[Dict[str, Any]]):
    """Sync receiving data"""
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute("""
                INSERT INTO receiving (
                    item_name, expected_qty, received_qty, supplier,
                    status, arrival_date, tracking_number, carrier
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                row.get('item_name') or row.get('Item Name'),
                int(row.get('expected_qty') or row.get('Expected Qty') or 0) if row.get('expected_qty') or row.get('Expected Qty') else None,
                int(row.get('received_qty') or row.get('Received Qty') or 0) if row.get('received_qty') or row.get('Received Qty') else None,
                row.get('supplier') or row.get('Supplier'),
                row.get('status') or row.get('Status') or 'Pending',
                parse_date(row.get('arrival_date') or row.get('Arrival Date')),
                row.get('tracking_number') or row.get('Tracking Number'),
                row.get('carrier') or row.get('Carrier')
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} receiving items")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing receiving: {e}")
        raise
    finally:
        cur.close()

def sync_shipped(conn, data: List[Dict[str, Any]]):
    """Sync shipped data"""
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute("""
                INSERT INTO shipped (
                    id, order_id, shipped_date, carrier,
                    tracking_number, serial_numbers, tech_name, status
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    order_id = EXCLUDED.order_id,
                    shipped_date = EXCLUDED.shipped_date,
                    carrier = EXCLUDED.carrier,
                    tracking_number = EXCLUDED.tracking_number,
                    serial_numbers = EXCLUDED.serial_numbers,
                    tech_name = EXCLUDED.tech_name,
                    status = EXCLUDED.status
            """, (
                row.get('id') or row.get('ID'),
                row.get('order_id') or row.get('Order ID'),
                parse_timestamp(row.get('shipped_date') or row.get('Shipped Date')) or datetime.now(),
                row.get('carrier') or row.get('Carrier'),
                row.get('tracking_number') or row.get('Tracking Number'),
                row.get('serial_numbers') or row.get('Serial Numbers'),
                row.get('tech_name') or row.get('Tech Name'),
                row.get('status') or row.get('Status')
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} shipped items")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing shipped: {e}")
        raise
    finally:
        cur.close()

def sync_sku_stock(conn, data: List[Dict[str, Any]]):
    """Sync SKU stock data"""
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute("""
                INSERT INTO sku_stock (
                    sku, quantity, title, serial_numbers
                ) VALUES (%s, %s, %s, %s)
                ON CONFLICT (sku) DO UPDATE SET
                    quantity = EXCLUDED.quantity,
                    title = EXCLUDED.title,
                    serial_numbers = EXCLUDED.serial_numbers
            """, (
                row.get('sku') or row.get('SKU'),
                int(row.get('quantity') or row.get('Quantity') or 0) if row.get('quantity') or row.get('Quantity') else 0,
                row.get('title') or row.get('Title'),
                row.get('serial_numbers') or row.get('Serial Numbers')
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} SKU stock items")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing sku_stock: {e}")
        raise
    finally:
        cur.close()

def sync_sku(conn, data: List[Dict[str, Any]]):
    """Sync SKU data"""
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute("""
                INSERT INTO skus (
                    sku, serial_numbers, notes
                ) VALUES (%s, %s, %s)
                ON CONFLICT (sku) DO UPDATE SET
                    serial_numbers = EXCLUDED.serial_numbers,
                    notes = EXCLUDED.notes
            """, (
                row.get('sku') or row.get('SKU'),
                row.get('serial_numbers') or row.get('Serial Numbers'),
                row.get('notes') or row.get('Notes')
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} SKUs")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing skus: {e}")
        raise
    finally:
        cur.close()

def fetch_sheet_data_via_apps_script(sheet_name: str) -> List[Dict[str, Any]]:
    """Fetch sheet data via Google Apps Script Web App"""
    if not APPS_SCRIPT_WEBAPP_URL:
        raise ValueError("APPS_SCRIPT_WEBAPP_URL is not set")
    
    try:
        response = requests.post(
            APPS_SCRIPT_WEBAPP_URL,
            json={'sheet_name': sheet_name, 'action': 'get_data'},
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        return data.get('data', [])
    except Exception as e:
        print(f"❌ Error fetching {sheet_name} via Apps Script: {e}")
        return []

def sync_all_sheets():
    """Sync all sheets to database"""
    conn = get_db_connection()
    
    try:
        print("Starting Google Sheets to Neon DB sync...\n")
        
        # Sync orders
        orders_data = fetch_sheet_data_via_apps_script('orders')
        if orders_data:
            sync_orders(conn, orders_data)
        
        # Sync tech tables
        for tech_num in range(3):
            tech_data = fetch_sheet_data_via_apps_script(f'tech_{tech_num}')
            if tech_data:
                sync_tech_table(conn, tech_num, tech_data)
        
        # Sync packer tables
        for packer_num in range(2):
            packer_data = fetch_sheet_data_via_apps_script(f'Packer_{packer_num}')
            if packer_data:
                sync_packer_table(conn, packer_num, packer_data)
        
        # Sync receiving
        receiving_data = fetch_sheet_data_via_apps_script('receiving')
        if receiving_data:
            sync_receiving(conn, receiving_data)
        
        # Sync shipped
        shipped_data = fetch_sheet_data_via_apps_script('shipped')
        if shipped_data:
            sync_shipped(conn, shipped_data)
        
        # Sync sku-stock
        sku_stock_data = fetch_sheet_data_via_apps_script('sku-stock')
        if sku_stock_data:
            sync_sku_stock(conn, sku_stock_data)
        
        # Sync sku
        sku_data = fetch_sheet_data_via_apps_script('sku')
        if sku_data:
            sync_sku(conn, sku_data)
        
        print("\n✅ All sheets synced successfully!")
        
    except Exception as e:
        print(f"\n❌ Sync failed: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    sync_all_sheets()
