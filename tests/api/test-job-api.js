// Direct API test to reproduce the "record 'new' has no field 'id'" error
// This bypasses the UI and tests the database directly

const https = require('https');

const SUPABASE_URL = 'https://api.onpointprodoors.com/rest/v1';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  process.exit(1);
}

function makeRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        'X-Client-Info': 'postgrest-js/1.0.0'
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

async function testJobCreation() {
  console.log('========================================');
  console.log('API JOB CREATION TEST');
  console.log('========================================\n');

  const testJob = {
    job_id: `api-test-${Date.now()}`,
    customer_name: 'API Test Customer',
    source: 'SONART CONSTRUCTION',
    status: 'new',
    phone: '555-1234',
    address: '123 Test St',
    city: 'Brooklyn',
    zip: '11201'
  };

  console.log('Attempting to create job via REST API:');
  console.log(JSON.stringify(testJob, null, 2));
  console.log('');

  try {
    const response = await makeRequest('POST', '/jobs?select=*', testJob);

    console.log(`Response Status: ${response.status}`);
    console.log('Response Data:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('');

    if (response.status === 201) {
      console.log('✓ Job created successfully!');
      console.log('');

      // Check if id field was populated
      if (response.data && response.data.length > 0) {
        const created = response.data[0];
        console.log('Created job data:');
        console.log(`  job_id: ${created.job_id}`);
        console.log(`  id: ${created.id || '(not set)'}`);
        console.log('');

        if (!created.id) {
          console.log('⚠ WARNING: id field is not populated!');
        }
      }

      return true;
    } else if (response.data && response.data.code === '42703') {
      console.log('❌ DATABASE ERROR DETECTED!');
      console.log('Error Code: 42703');
      console.log('Error Message:', response.data.message);
      console.log('');
      console.log('This is the "record \'new\' has no field \'id\'" error!');
      return false;
    } else {
      console.log(`❌ Unexpected response: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log('❌ Request failed:', error.message);
    return false;
  }
}

testJobCreation().then(success => {
  process.exit(success ? 0 : 1);
});
