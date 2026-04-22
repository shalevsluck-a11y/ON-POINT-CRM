// Test job creation with anon key (same as browser)
const https = require('https');

const SUPABASE_URL = 'https://api.onpointprodoors.com/rest/v1';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc2ODI5Mjg5LCJleHAiOjE5MzQ1MDkyODl9.E8NSAZFNAMAUvWpLLR3xBVmrwnTDwawMYIMy9V_pWyU';

function makeRequest(method, path, data, authToken = ANON_KEY) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };

    const req = https.request(url, options, (res) => {
      let body = '';

      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : null;
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function test() {
  console.log('Testing job creation with anon key...\n');

  const testJob = {
    job_id: `anon-test-${Date.now()}`,
    customer_name: 'Anon Test',
    source: 'SONART CONSTRUCTION',
    status: 'new'
  };

  console.log('Creating job:', testJob);

  const response = await makeRequest('POST', '/jobs?select=*', testJob);

  console.log(`\nStatus: ${response.status}`);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.data && (response.data.code === '42703' || response.data.message?.includes('has no field "id"'))) {
    console.log('\n❌ ERROR REPRODUCED: record "new" has no field "id"');
    console.log('Error code:', response.data.code);
    console.log('Message:', response.data.message);
    process.exit(1);
  } else if (response.status === 201) {
    console.log('\n✓ Job created successfully');
    process.exit(0);
  } else {
    console.log('\n⚠ Unexpected response');
    process.exit(1);
  }
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
