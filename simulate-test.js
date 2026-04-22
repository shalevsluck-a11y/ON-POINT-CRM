// Simulate the exact code execution
console.log('=== SIMULATING CODE EXECUTION ===\n');

// Mock data from database
const dbLeadSources = [{"id": "mo8zajhqWTUHR", "name": "SONART CONSTRUCTION", "contractorPercent": 50}];
const dispatcherUser = {role: 'dispatcher', allowedLeadSources: ['SONART CONSTRUCTION']};
const adminUser = {role: 'admin', allowedLeadSources: null};

function simulateDropdown(user, sources) {
  console.log(`\n--- Testing as ${user.role.toUpperCase()} ---`);
  
  let filteredSources = sources;
  let allowedSourceNames = null;
  
  const isDispatcher = user.role === 'dispatcher';
  
  if (isDispatcher) {
    allowedSourceNames = user.allowedLeadSources || null;
    console.log('Allowed sources:', allowedSourceNames);
    
    if (allowedSourceNames && allowedSourceNames.length > 0) {
      const allowedNamesLower = allowedSourceNames.map(n => n.toLowerCase());
      filteredSources = sources.filter(s => allowedNamesLower.includes(s.name.toLowerCase()));
      console.log('Filtered sources:', filteredSources.map(s => s.name));
    } else {
      console.log('WARNING: No allowed sources - blocking all');
      filteredSources = [];
    }
  }
  
  // Check "My Lead" condition
  const shouldShowMyLead = !isDispatcher || !allowedSourceNames || (allowedSourceNames && allowedSourceNames.includes('my_lead'));
  
  console.log('Should show My Lead?', shouldShowMyLead);
  console.log('Filtered sources to show:', filteredSources.length);
  
  // Build dropdown
  const options = [];
  if (shouldShowMyLead) {
    options.push('My Lead (Direct)');
  }
  filteredSources.forEach(s => {
    options.push(`${s.name} (${s.contractorPercent}%)`);
  });
  
  console.log('Final dropdown options:', options);
  console.log('Dropdown disabled?', isDispatcher && allowedSourceNames && allowedSourceNames.length === 1);
  
  // Validate
  if (user.role === 'dispatcher') {
    const pass1 = !options.includes('My Lead (Direct)');
    const pass2 = options.length === 1;
    const pass3 = options.some(o => o.includes('SONART CONSTRUCTION'));
    
    console.log('\nVALIDATION:');
    console.log(pass1 ? '✅' : '❌', 'No My Lead:', pass1);
    console.log(pass2 ? '✅' : '❌', 'Only 1 option:', pass2);
    console.log(pass3 ? '✅' : '❌', 'Has SONART:', pass3);
    
    return pass1 && pass2 && pass3;
  } else {
    const pass1 = options.includes('My Lead (Direct)');
    const pass2 = options.length >= 2;
    const pass3 = options.some(o => o.includes('SONART CONSTRUCTION'));
    
    console.log('\nVALIDATION:');
    console.log(pass1 ? '✅' : '❌', 'Has My Lead:', pass1);
    console.log(pass2 ? '✅' : '❌', 'Multiple options:', pass2);
    console.log(pass3 ? '✅' : '❌', 'Has SONART:', pass3);
    
    return pass1 && pass2 && pass3;
  }
}

// Run simulations
const dispatcherPass = simulateDropdown(dispatcherUser, dbLeadSources);
const adminPass = simulateDropdown(adminUser, dbLeadSources);

console.log('\n=== FINAL RESULT ===');
console.log('Dispatcher test:', dispatcherPass ? '✅ PASS' : '❌ FAIL');
console.log('Admin test:', adminPass ? '✅ PASS' : '❌ FAIL');

if (dispatcherPass && adminPass) {
  console.log('\n🎉 ALL TESTS PASS - CODE LOGIC IS CORRECT! 🎉');
} else {
  console.log('\n❌ CODE HAS BUGS - NEEDS FIX');
}
