// ============================================
// IN-BROWSER TEST SCRIPT
// Run this in the browser console while logged in
// ============================================

(function() {
  console.log('='.repeat(80));
  console.log('STARTING AUTOMATED IN-BROWSER TEST');
  console.log('='.repeat(80));

  const results = {
    timestamp: new Date().toISOString(),
    user: null,
    settings: null,
    sourceDropdown: null,
    tests: []
  };

  function test(name, condition, details) {
    const passed = !!condition;
    results.tests.push({ name, passed, details });
    console.log(`[${passed ? '✅ PASS' : '❌ FAIL'}] ${name}: ${details}`);
    return passed;
  }

  // Get current user
  results.user = Auth.getUser();
  console.log('\n--- USER INFO ---');
  console.log('Role:', results.user?.role);
  console.log('Name:', results.user?.name);
  console.log('Allowed Lead Sources:', results.user?.allowedLeadSources);

  test('User Loaded', results.user, `User: ${results.user?.name || 'NONE'}`);
  test('User Has Role', results.user?.role, `Role: ${results.user?.role || 'NONE'}`);

  // Get settings
  results.settings = DB.getSettings();
  console.log('\n--- SETTINGS INFO ---');
  console.log('Lead Sources:', results.settings?.leadSources);
  console.log('Lead Sources Count:', results.settings?.leadSources?.length || 0);

  test('Settings Loaded', results.settings, 'Settings object exists');
  test('Lead Sources Loaded', results.settings?.leadSources?.length > 0,
    `Found ${results.settings?.leadSources?.length || 0} lead sources`);

  if (results.settings?.leadSources?.length > 0) {
    console.log('\n--- LEAD SOURCES DETAIL ---');
    results.settings.leadSources.forEach((src, i) => {
      console.log(`${i + 1}. ${src.name} (${src.contractorPercent}%) - ID: ${src.id}`);
    });
  }

  // Navigate to New Job and check dropdown
  console.log('\n--- NAVIGATING TO NEW JOB ---');
  console.log('Clicking New Job button...');

  setTimeout(() => {
    // Click new job button
    const newJobBtn = document.querySelector('.nav-item[data-view="new-job"]');
    if (newJobBtn) {
      newJobBtn.click();

      setTimeout(() => {
        // Check dropdown
        const dropdown = document.getElementById('f-source');
        if (dropdown) {
          const options = Array.from(dropdown.options).map(o => ({
            value: o.value,
            text: o.textContent
          }));

          results.sourceDropdown = {
            disabled: dropdown.disabled,
            options: options,
            selectedValue: dropdown.value
          };

          console.log('\n--- SOURCE DROPDOWN INFO ---');
          console.log('Disabled:', dropdown.disabled);
          console.log('Options:', options);

          // Run dropdown tests
          const isDispatcher = Auth.isDispatcher();
          const isAdmin = Auth.isAdmin();

          test('Dropdown Found', true, 'Source dropdown exists');
          test('Dropdown Has Options', options.length > 0, `Found ${options.length} options`);

          if (isDispatcher) {
            const allowedSources = results.user?.allowedLeadSources || [];
            const hasMyLead = options.some(o => o.text.includes('My Lead'));
            const hasAllowed = allowedSources.length > 0 ?
              options.some(o => allowedSources.some(a => o.text.includes(a))) :
              false;

            test('Dispatcher - Dropdown Disabled', dropdown.disabled,
              dropdown.disabled ? 'Correctly disabled' : 'ERROR: Should be disabled!');
            test('Dispatcher - No My Lead', !hasMyLead,
              hasMyLead ? 'ERROR: My Lead should not be visible!' : 'Correctly hidden');
            test('Dispatcher - Shows Allowed Source', hasAllowed,
              hasAllowed ? 'Correct source shown' : 'ERROR: Allowed source not shown!');
            test('Dispatcher - Only One Option', options.length === 1,
              `Found ${options.length} options (should be 1)`);
          }

          if (isAdmin) {
            const hasMyLead = options.some(o => o.text.includes('My Lead'));
            const hasLeadSources = options.some(o => o.text.includes('CONSTRUCTION') || o.text.includes('SONART'));

            test('Admin - Dropdown Enabled', !dropdown.disabled,
              dropdown.disabled ? 'ERROR: Should be enabled!' : 'Correctly enabled');
            test('Admin - Has My Lead', hasMyLead,
              hasMyLead ? 'Correctly shown' : 'ERROR: My Lead missing!');
            test('Admin - Has Lead Sources', hasLeadSources,
              hasLeadSources ? 'Lead sources shown' : 'ERROR: No lead sources!');
            test('Admin - Multiple Options', options.length >= 2,
              `Found ${options.length} options (should be >= 2)`);
          }

          // Print final report
          console.log('\n' + '='.repeat(80));
          console.log('TEST SUMMARY');
          console.log('='.repeat(80));
          const passed = results.tests.filter(t => t.passed).length;
          const failed = results.tests.filter(t => !t.passed).length;
          console.log(`Total: ${results.tests.length}`);
          console.log(`✅ Passed: ${passed}`);
          console.log(`❌ Failed: ${failed}`);
          console.log('='.repeat(80));

          if (failed > 0) {
            console.log('\n❌ FAILED TESTS:');
            results.tests.filter(t => !t.passed).forEach(t => {
              console.log(`  - ${t.name}: ${t.details}`);
            });
          }

          console.log('\n📋 FULL RESULTS (copy this):');
          console.log(JSON.stringify(results, null, 2));

        } else {
          console.error('❌ ERROR: Source dropdown not found!');
        }
      }, 2000); // Wait 2s for form to load
    } else {
      console.error('❌ ERROR: New Job button not found!');
    }
  }, 1000);

})();

console.log('\n⏳ Test running... Results will appear in 3 seconds...\n');
