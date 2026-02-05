require('dotenv').config();
const { Pool } = require('pg');
const readline = require('readline');

const CLIENT_ID = process.env.EBAY_APP_ID;
const CLIENT_SECRET = process.env.EBAY_CERT_ID;
const RU_NAME = process.env.EBAY_RU_NAME;

console.log('\n🔐 eBay OAuth Token Generator\n');
console.log('════════════════════════════════════════════════════════════════');
console.log('\n📋 Step 1: Open this URL in your browser:\n');
console.log('https://auth.ebay.com/oauth2/authorize?client_id=' + CLIENT_ID + '&redirect_uri=' + RU_NAME + '&response_type=code&scope=https://api.ebay.com/oauth/api_scope%20https://api.ebay.com/oauth/api_scope/sell.fulfillment%20https://api.ebay.com/oauth/api_scope/sell.inventory%20https://api.ebay.com/oauth/api_scope/sell.marketing%20https://api.ebay.com/oauth/api_scope/sell.account&prompt=login');
console.log('\n📋 Step 2: Sign in and click "Agree"');
console.log('📋 Step 3: Copy the ENTIRE URL from browser address bar after redirect');
console.log('════════════════════════════════════════════════════════════════\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Paste the redirect URL here (or just the code parameter): ', async (input) => {
  try {
    // Extract code from URL or use as-is if it's just the code
    let authCode = input.trim();
    
    // If it's a full URL, extract the code parameter
    if (authCode.includes('code=')) {
      const urlParams = new URLSearchParams(authCode.split('?')[1]);
      authCode = urlParams.get('code') || authCode;
    }
    
    // URL decode if needed
    if (authCode.includes('%')) {
      authCode = decodeURIComponent(authCode);
    }

    console.log('\n🔓 Using authorization code:', authCode.substring(0, 40) + '...\n');
    console.log('🔄 Exchanging for tokens...\n');

    // Exchange code for tokens
    const url = 'https://api.ebay.com/identity/v1/oauth2/token';
    const authString = `${CLIENT_ID}:${CLIENT_SECRET}`;
    const base64Auth = Buffer.from(authString).toString('base64');
    
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: RU_NAME,
    });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${base64Auth}`,
      },
      body: body.toString(),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    console.log('✅ SUCCESS! Tokens generated!\n');
    
    // Update database
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    await pool.query(
      `UPDATE ebay_accounts 
       SET access_token = $1, 
           refresh_token = $2,
           token_expires_at = NOW() + INTERVAL '2 hours',
           refresh_token_expires_at = NOW() + INTERVAL '18 months',
           updated_at = NOW()
       WHERE account_name = 'USAV'`,
      [data.access_token, data.refresh_token]
    );
    
    await pool.end();
    
    console.log('✅ Tokens saved to database!\n');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('🔑 Access Token:', data.access_token.substring(0, 50) + '...');
    console.log('🔄 Refresh Token:', data.refresh_token);
    console.log('⏰ Expires in:', data.expires_in, 'seconds (', Math.floor(data.expires_in / 3600), 'hours )');
    console.log('════════════════════════════════════════════════════════════════\n');
    console.log('✅ All set! You can now sync eBay orders from the admin dashboard.\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    rl.close();
  }
});
