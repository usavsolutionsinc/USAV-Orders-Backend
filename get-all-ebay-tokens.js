const { Pool } = require('pg');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function getTokensForAccount(accountName) {
  const clientId = process.env.EBAY_APP_ID;
  const clientSecret = process.env.EBAY_CERT_ID;
  const ruName = process.env.EBAY_RU_NAME;
  
  if (!clientId || !clientSecret || !ruName) {
    throw new Error('Missing required environment variables: EBAY_APP_ID, EBAY_CERT_ID, EBAY_RU_NAME');
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`GETTING TOKENS FOR: ${accountName}`);
  console.log('='.repeat(60));
  
  // Generate OAuth URL
  const scopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account'
  ].join(' ');
  
  const oauthUrl = `https://auth.ebay.com/oauth2/authorize?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `response_type=code&` +
    `redirect_uri=${encodeURIComponent(ruName)}&` +
    `scope=${encodeURIComponent(scopes)}`;
  
  console.log('\n📋 STEP 1: Open this URL in your browser:');
  console.log('\x1b[36m%s\x1b[0m', oauthUrl);
  console.log('\n⚠️  IMPORTANT: Log in with the', accountName, 'eBay account!\n');
  
  const authCode = await question('📝 Paste the authorization code here (URL-encoded is OK): ');
  
  // Decode if URL-encoded
  const decodedCode = authCode.includes('%') ? decodeURIComponent(authCode) : authCode;
  
  console.log('\n🔄 Exchanging code for tokens...');
  
  // Exchange code for tokens
  const authString = `${clientId}:${clientSecret}`;
  const base64Auth = Buffer.from(authString).toString('base64');
  
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${base64Auth}`
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: decodedCode,
      redirect_uri: ruName
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }
  
  const tokens = await response.json();
  
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Invalid token response: missing access_token or refresh_token');
  }
  
  console.log('✅ Tokens obtained successfully!');
  
  // Save to database
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 7200) * 1000);
    const refreshExpiresAt = new Date(Date.now() + (tokens.refresh_token_expires_in || 47304000) * 1000);
    
    await pool.query(
      `UPDATE ebay_accounts 
       SET access_token = $1, 
           refresh_token = $2, 
           token_expires_at = $3,
           refresh_token_expires_at = $4,
           is_active = true
       WHERE account_name = $5`,
      [tokens.access_token, tokens.refresh_token, expiresAt, refreshExpiresAt, accountName]
    );
    
    console.log(`✅ Saved tokens to database for ${accountName}`);
    console.log(`   Access token expires: ${expiresAt.toLocaleString()}`);
    console.log(`   Refresh token expires: ${refreshExpiresAt.toLocaleString()}`);
    
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('\n🚀 eBay Multi-Account Token Setup');
  console.log('This script will help you get OAuth tokens for all three accounts.\n');
  
  const accounts = ['USAV', 'DRAGON', 'MEKONG'];
  
  for (const account of accounts) {
    const answer = await question(`\n❓ Do you want to get tokens for ${account}? (y/n): `);
    
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      try {
        await getTokensForAccount(account);
      } catch (error) {
        console.error(`\n❌ Error getting tokens for ${account}:`, error.message);
        console.log('Skipping to next account...');
      }
    } else {
      console.log(`⏭️  Skipping ${account}`);
    }
  }
  
  // Show final status
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log('\n' + '='.repeat(60));
    console.log('FINAL STATUS - All eBay Accounts:');
    console.log('='.repeat(60));
    
    const result = await pool.query(`
      SELECT account_name, 
             token_expires_at,
             is_active,
             CASE 
               WHEN access_token = 'placeholder' THEN '❌ No token'
               WHEN token_expires_at < NOW() THEN '⚠️  Expired'
               WHEN token_expires_at < NOW() + INTERVAL '1 hour' THEN '⚠️  Expires soon'
               ELSE '✅ Valid'
             END as status
      FROM ebay_accounts
      ORDER BY account_name
    `);
    
    result.rows.forEach(row => {
      console.log(`\n${row.account_name}:`);
      console.log(`  Status: ${row.status}`);
      console.log(`  Active: ${row.is_active ? '✅' : '❌'}`);
      console.log(`  Expires: ${row.token_expires_at.toLocaleString()}`);
    });
    
  } finally {
    await pool.end();
  }
  
  console.log('\n✨ Setup complete!\n');
  rl.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  rl.close();
  process.exit(1);
});
