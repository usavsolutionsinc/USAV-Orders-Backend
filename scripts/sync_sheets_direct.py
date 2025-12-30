#!/usr/bin/env python3
"""
Sync data from Google Sheets to Neon Postgres database.
Matches exact column structure from Google Sheets.
Tables: orders, tech_1-3, receiving, Packer_1-3, shipped, sku_stock, sku
Note: Table numbering starts from 1 (not 0) to match website naming.
"""

import os
import gspread
from google.oauth2.service_account import Credentials
import psycopg2
from datetime import datetime
from dotenv import load_dotenv
from typing import List, Dict, Any, Optional

# Load environment variables
load_dotenv('.env.local')

DATABASE_URL = os.getenv('DATABASE_URL')
GOOGLE_CLIENT_EMAIL = os.getenv('GOOGLE_CLIENT_EMAIL')
GOOGLE_PRIVATE_KEY = os.getenv('GOOGLE_PRIVATE_KEY')
GOOGLE_SHEET_ID = os.getenv('GOOGLE_SHEET_ID')

if not all([DATABASE_URL, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID]):
    raise ValueError("Required environment variables are not set")

def get_google_sheets_client():
    """Get authenticated Google Sheets client"""
    scope = ['https://spreadsheets.google.com/feeds',
             'https://www.googleapis.com/auth/drive']
    
    creds_dict = {
        "type": "service_account",
        "client_email": GOOGLE_CLIENT_EMAIL,
        "private_key": GOOGLE_PRIVATE_KEY.replace('\\n', '\n'),
        "token_uri": "https://oauth2.googleapis.com/token"
    }
    
    creds = Credentials.from_service_account_info(creds_dict, scopes=scope)
    return gspread.authorize(creds)

def get_db_connection():
    """Get database connection"""
    return psycopg2.connect(DATABASE_URL, sslmode='require')

def parse_timestamp(timestamp_str: Optional[str]) -> Optional[datetime]:
    """Parse timestamp string from Google Sheets"""
    if not timestamp_str or timestamp_str == '':
        return None
    try:
        # Try various timestamp formats
        if isinstance(timestamp_str, datetime):
            return timestamp_str
        
        for fmt in ['%m/%d/%Y %H:%M:%S', '%Y-%m-%d %H:%M:%S', '%m/%d/%Y %H:%M', '%m/%d/%Y']:
            try:
                return datetime.strptime(str(timestamp_str).strip(), fmt)
            except:
                continue
        return None
    except:
        return None

def sheet_to_dict_list(worksheet) -> List[Dict[str, Any]]:
    """Convert Google Sheets worksheet to list of dictionaries"""
    try:
        # Get all values
        all_values = worksheet.get_all_values()
        
        if len(all_values) < 2:
            return []
        
        # First row is headers
        headers = [h.strip() for h in all_values[0]]
        
        # Convert rows to dictionaries
        result = []
        for row in all_values[1:]:
            row_dict = {}
            for i, header in enumerate(headers):
                if i < len(row):
                    value = row[i].strip() if row[i] else ''
                    row_dict[header] = value if value else None
                else:
                    row_dict[header] = None
            
            # Only add if row has data
            if any(row_dict.values()):
                result.append(row_dict)
        
        return result
    except Exception as e:
        print(f"Error reading sheet {worksheet.title}: {e}")
        return []

def sync_orders(conn, data: List[Dict[str, Any]]):
    """Sync orders data - Columns A-P"""
    cur = conn.cursor()
    try:
        for row in data:
            # Map exact column names from Google Sheets
            order_id = row.get('Order ID') or row.get('order_id') or row.get('Order ID')
            if not order_id:
                continue
                
            cur.execute("""
                INSERT INTO orders (
                    id, order_id, size, platform, buyer_name, product_title, quantity,
                    ship, sku, item_index, asin, shipping_trk_number, oos_needed,
                    receiving_trk_number, stock_status_location, notes
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    size = EXCLUDED.size,
                    platform = EXCLUDED.platform,
                    order_id = EXCLUDED.order_id,
                    buyer_name = EXCLUDED.buyer_name,
                    product_title = EXCLUDED.product_title,
                    quantity = EXCLUDED.quantity,
                    ship = EXCLUDED.ship,
                    sku = EXCLUDED.sku,
                    item_index = EXCLUDED.item_index,
                    asin = EXCLUDED.asin,
                    shipping_trk_number = EXCLUDED.shipping_trk_number,
                    oos_needed = EXCLUDED.oos_needed,
                    receiving_trk_number = EXCLUDED.receiving_trk_number,
                    stock_status_location = EXCLUDED.stock_status_location,
                    notes = EXCLUDED.notes
            """, (
                order_id,  # id (primary key)
                order_id,  # order_id
                row.get('SIZE') or row.get('Size') or row.get('size'),
                row.get('Platform') or row.get('platform'),
                row.get('Buyer Name') or row.get('buyer_name') or row.get('Buyer Name'),
                row.get('Product Title') or row.get('product_title') or row.get('Product Title'),
                int(row.get('#') or row.get('quantity') or row.get('Qty') or 0) if (row.get('#') or row.get('quantity') or row.get('Qty')) else None,
                row.get('Ship') or row.get('ship'),
                row.get('SKU') or row.get('sku') or row.get('SKU'),
                row.get('Item #') or row.get('item_index') or row.get('Item #'),
                row.get('As') or row.get('asin') or row.get('As'),
                row.get('Shipping TRK #') or row.get('shipping_trk_number') or row.get('Shipping TRK #'),
                row.get('OOS - We Need') or row.get('oos_needed') or row.get('OOS - We Need'),
                row.get('Receiving TRK #') or row.get('receiving_trk_number') or row.get('Receiving TRK #'),
                row.get('Stock Status / Location') or row.get('stock_status_location') or row.get('Stock Status / Location'),
                row.get('Notes') or row.get('notes') or row.get('Notes')
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} orders")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing orders: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()

def sync_tech_table(conn, tech_num: int, data: List[Dict[str, Any]]):
    """Sync tech table data - Columns A-H"""
    table_name = f"tech_{tech_num}"
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute(f"""
                INSERT INTO {table_name} (
                    date_time, title_testing, shipping_trk_testing, serial_number_data,
                    input, asin, sku, quantity, tech_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                parse_timestamp(row.get('Date / Time') or row.get('date_time') or row.get('Date / Time')),
                row.get('Title - Testing') or row.get('title_testing') or row.get('Title - Testing'),
                row.get('Shipping TRK # / Testing') or row.get('shipping_trk_testing') or row.get('Shipping TRK # / Testing'),
                row.get('Serial Number Data') or row.get('serial_number_data') or row.get('Serial Number Data'),
                row.get('Input') or row.get('input') or row.get('Input'),
                row.get('As') or row.get('asin') or row.get('As'),
                row.get('SKU') or row.get('sku') or row.get('SKU'),
                int(row.get('#') or row.get('quantity') or row.get('Qty') or 0) if (row.get('#') or row.get('quantity') or row.get('Qty')) else None,
                str(tech_num)
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} rows to {table_name}")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing {table_name}: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()

def sync_packer_table(conn, packer_num: int, data: List[Dict[str, Any]]):
    """Sync packer table data - Columns A-D"""
    table_name = f"Packer_{packer_num}"
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute(f"""
                INSERT INTO {table_name} (
                    date_time, tracking_number_fnsku, order_id, product_title, quantity, packer_id
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                parse_timestamp(row.get('Date / Time') or row.get('date_time') or row.get('Date / Time')),
                row.get('Tracking Number/FNSKU') or row.get('tracking_number_fnsku') or row.get('Tracking Number/FNSKU'),
                row.get('ID') or row.get('order_id') or row.get('ID'),
                row.get('Product Title') or row.get('product_title') or row.get('Product Title'),
                int(row.get('#') or row.get('quantity') or row.get('Qty') or 0) if (row.get('#') or row.get('quantity') or row.get('Qty')) else None,
                str(packer_num)
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} rows to {table_name}")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing {table_name}: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()

def sync_receiving(conn, data: List[Dict[str, Any]]):
    """Sync receiving data - Columns A-D"""
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute("""
                INSERT INTO receiving (
                    date_time, tracking_number, carrier, qty
                ) VALUES (%s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                parse_timestamp(row.get('Date / Time') or row.get('date_time') or row.get('Date / Time')),
                row.get('Tracking Number') or row.get('tracking_number') or row.get('Tracking Number'),
                row.get('Carrier') or row.get('carrier') or row.get('Carrier'),
                int(row.get('Qty') or row.get('quantity') or row.get('Qty') or 0) if (row.get('Qty') or row.get('quantity') or row.get('Qty')) else None
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} receiving items")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing receiving: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()

def sync_shipped(conn, data: List[Dict[str, Any]]):
    """Sync shipped data - Columns A-J"""
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute("""
                INSERT INTO shipped (
                    date_time, order_id, product_title, sent, shipping_trk_number,
                    serial_number, box, by_name, sku, status
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                parse_timestamp(row.get('Date / Time') or row.get('date_time') or row.get('Date / Time')) or datetime.now(),
                row.get('Order ID') or row.get('order_id') or row.get('Order ID'),
                row.get('Product Title') or row.get('product_title') or row.get('Product Title'),
                row.get('Sent') or row.get('sent') or row.get('Sent'),
                row.get('Shipping TRK #') or row.get('shipping_trk_number') or row.get('Shipping TRK #'),
                row.get('Serial Number') or row.get('serial_number') or row.get('Serial Number'),
                row.get('Box') or row.get('box') or row.get('Box'),
                row.get('By') or row.get('by_name') or row.get('By'),
                row.get('SKU') or row.get('sku') or row.get('SKU'),
                row.get('Status') or row.get('status') or row.get('Status')
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} shipped items")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing shipped: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()

def sync_sku_stock(conn, data: List[Dict[str, Any]]):
    """Sync SKU stock data - Columns A-E"""
    cur = conn.cursor()
    try:
        for row in data:
            sku = row.get('SKU') or row.get('sku') or row.get('SKU')
            if not sku:
                continue
                
            cur.execute("""
                INSERT INTO sku_stock (
                    sku, size, title, condition, quantity
                ) VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (sku) DO UPDATE SET
                    size = EXCLUDED.size,
                    title = EXCLUDED.title,
                    condition = EXCLUDED.condition,
                    quantity = EXCLUDED.quantity
            """, (
                sku,
                row.get('Size') or row.get('size') or row.get('Size'),
                row.get('Title') or row.get('title') or row.get('Title'),
                row.get('Condition') or row.get('condition') or row.get('Condition'),
                int(row.get('Quantity') or row.get('quantity') or row.get('Qty') or 0) if (row.get('Quantity') or row.get('quantity') or row.get('Qty')) else 0
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} SKU stock items")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing sku_stock: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()

def sync_sku(conn, data: List[Dict[str, Any]]):
    """Sync SKU data - Columns A-H"""
    cur = conn.cursor()
    try:
        for row in data:
            cur.execute("""
                INSERT INTO skus (
                    store_date_time, static_sku, serial_numbers, shipping_trk_number,
                    product_title, size, notes, location
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                parse_timestamp(row.get('Store Date / Time') or row.get('store_date_time') or row.get('Store Date / Time')),
                row.get('Static SKU') or row.get('static_sku') or row.get('Static SKU'),
                row.get('Serial Numbers') or row.get('serial_numbers') or row.get('Serial Numbers'),
                row.get('Shipping TRK #') or row.get('shipping_trk_number') or row.get('Shipping TRK #'),
                row.get('Product Title') or row.get('product_title') or row.get('Product Title'),
                row.get('Size') or row.get('size') or row.get('Size'),
                row.get('Notes') or row.get('notes') or row.get('Notes'),
                row.get('Location') or row.get('location') or row.get('Location')
            ))
        conn.commit()
        print(f"✓ Synced {len(data)} SKUs")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error syncing skus: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()

def sync_all_sheets_direct():
    """Sync all sheets to database using direct Google Sheets API"""
    client = get_google_sheets_client()
    spreadsheet = client.open_by_key(GOOGLE_SHEET_ID)
    conn = get_db_connection()
    
    try:
        print("Starting Google Sheets to Neon DB sync (Direct API)...\n")
        
        # Sheet to sync function mapping - Updated to use 1-based numbering
        sheet_mappings = {
            'orders': (sync_orders, 'orders'),
            'tech_1': (lambda conn, data: sync_tech_table(conn, 1, data), 'tech_1'),
            'tech_2': (lambda conn, data: sync_tech_table(conn, 2, data), 'tech_2'),
            'tech_3': (lambda conn, data: sync_tech_table(conn, 3, data), 'tech_3'),
            'Packer_1': (lambda conn, data: sync_packer_table(conn, 1, data), 'Packer_1'),
            'Packer_2': (lambda conn, data: sync_packer_table(conn, 2, data), 'Packer_2'),
            'Packer_3': (lambda conn, data: sync_packer_table(conn, 3, data), 'Packer_3'),
            'receiving': (sync_receiving, 'receiving'),
            'shipped': (sync_shipped, 'shipped'),
            'sku-stock': (sync_sku_stock, 'sku_stock'),
            'Sku-Stock': (sync_sku_stock, 'sku_stock'),  # Alternative name
            'sku': (sync_sku, 'skus'),
            'Sku': (sync_sku, 'skus'),  # Alternative name
        }
        
        for sheet_name, (sync_func, _) in sheet_mappings.items():
            try:
                worksheet = spreadsheet.worksheet(sheet_name)
                data = sheet_to_dict_list(worksheet)
                if data:
                    print(f"\nProcessing {sheet_name}... ({len(data)} rows)")
                    sync_func(conn, data)
                else:
                    print(f"  No data in {sheet_name}, skipping...")
            except gspread.exceptions.WorksheetNotFound:
                print(f"  Sheet '{sheet_name}' not found, skipping...")
            except Exception as e:
                print(f"  Error processing {sheet_name}: {e}")
                import traceback
                traceback.print_exc()
        
        print("\n✅ All sheets synced successfully!")
        
    except Exception as e:
        print(f"\n❌ Sync failed: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    sync_all_sheets_direct()
